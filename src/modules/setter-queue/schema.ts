import {z} from "zod";
import {wallTimeToInstants} from "@/modules/booking/zoned-time";

export const queueSnapshotSchema=z.object({
  enabled:z.boolean(),is_manager:z.boolean(),is_setter:z.boolean(),timezone:z.string(),on_shift_until:z.string().nullable(),
  buckets:z.record(z.string(),z.number()),
  members:z.array(z.object({user_id:z.uuid(),name:z.string(),role:z.string(),enabled:z.boolean(),on_shift_until:z.string().nullable()})),
  current:z.object({
    id:z.uuid(),claim_token:z.uuid(),title:z.string(),description:z.string().nullable(),due_at:z.string().nullable(),
    claim_expires_at:z.string(),attempted_at:z.string().nullable(),current_claim_attempted:z.boolean(),queue_bucket:z.string(),
    lead:z.object({id:z.uuid(),name:z.string(),phone:z.string(),email:z.string(),address:z.string(),source:z.string(),stage:z.string()}),
    estimate:z.object({roof_squares:z.number().nullable(),range_low_cents:z.number().nullable(),range_high_cents:z.number().nullable(),status:z.string()}).nullable(),
    messages:z.array(z.object({direction:z.string(),body:z.string(),status:z.string(),created_at:z.string()})),
    attempts:z.array(z.object({attempted_at:z.string(),user_id:z.uuid(),channel:z.string()})),
    outcomes:z.array(z.object({outcome:z.string(),notes:z.string().nullable(),created_at:z.string(),user_id:z.uuid()})),
    appointments:z.array(z.object({id:z.uuid(),meeting_type:z.string().nullable(),scheduled_at:z.string(),status:z.string(),reservable:z.boolean()})),
  }).nullable(),
});
export type QueueSnapshot=z.infer<typeof queueSnapshotSchema>;
export const callbackReportSchema=z.array(z.object({assigned_to:z.uuid().nullable(),name:z.string(),missed:z.number(),delivery_issues:z.number()}));
export type CallbackReport=z.infer<typeof callbackReportSchema>;

export function callbackLocalToIso(value:string,timeZone:string):string {
  const [date,time]=value.split("T");
  if(!z.iso.date().safeParse(date).success || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time??"")) throw new Error("Choose a valid callback time");
  const [hour,minute]=time.split(":").map(Number);
  const instants=wallTimeToInstants(date,hour*60+minute,timeZone);
  if(instants.length!==1) throw new Error("That time is skipped or repeated by daylight saving. Choose another time.");
  return instants[0].toISOString();
}

const claimFields={taskId:z.uuid(),token:z.uuid()};
const optionalId=z.preprocess(v=>v===""||v===undefined?null:v,z.uuid().nullable());
const outcomeSchema=z.object({
  action:z.literal("outcome"),...claimFields,
  outcome:z.enum(["booked_virtual","booked_in_home","callback_scheduled","no_answer","voicemail","not_interested","disqualified","handoff"]),
  notes:z.string().trim().max(2000).optional(),callbackLocal:z.string().optional(),appointmentId:optionalId,
}).strict();
const commandSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("claim")}).strict(),
  z.object({action:z.literal("attempt"),...claimFields}).strict(),
  z.object({action:z.literal("booking_link"),...claimFields}).strict(),
  z.object({action:z.literal("shift"),onShift:z.enum(["true","false"])}).strict(),
  z.object({action:z.literal("settings"),enabled:z.enum(["true","false"]),timezone:z.string().min(1).max(100)}).strict(),
  z.object({action:z.literal("enroll"),userId:z.uuid(),enabled:z.enum(["true","false"])}).strict(),
  outcomeSchema,
]);

export function parseQueueCommand(input:unknown,timeZone:string) {
  const command=commandSchema.parse(input);
  if(command.action!=="outcome") return command;
  if(["disqualified","handoff"].includes(command.outcome) && (command.notes?.length??0)<3) throw new Error("A reason is required");
  const callbackAt=command.outcome==="callback_scheduled"?callbackLocalToIso(command.callbackLocal??"",timeZone):null;
  if(command.outcome.startsWith("booked_") && !command.appointmentId) throw new Error("A real future appointment is required");
  return {action:command.action,taskId:command.taskId,token:command.token,outcome:command.outcome,notes:command.notes||null,
    callbackAt,appointmentId:command.outcome.startsWith("booked_")?command.appointmentId:null};
}

const SAFE_MESSAGES=new Set([
  "Queue access required","Manager access required","Active company member required","Go on shift before claiming a lead",
  "Record an outcome before going off shift","Finish your claim in the other company first","Choose a valid company time zone",
  "Claim expired or changed; reload the queue","Outcome already recorded; reload the queue","Choose a supported outcome",
  "A real future appointment is required","A reason is required","Choose a future callback within 90 days","Choose a valid callback time",
  "That time is skipped or repeated by daylight saving. Choose another time.",
]);
export function queueActionError(error:unknown):string {
  if(error && typeof error==="object" && "message" in error && typeof error.message==="string" && SAFE_MESSAGES.has(error.message)) return error.message;
  return "Couldn't update the queue. Reload and try again.";
}
