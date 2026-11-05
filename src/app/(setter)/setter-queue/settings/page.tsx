import {redirect} from "next/navigation";
import {createServerClient} from "@/lib/supabase/server";
import {callbackReportSchema,queueSnapshotSchema} from "@/modules/setter-queue/schema";
import {QueueSettings} from "../queue-settings";

export default async function SetterQueueSettingsPage() {
  const db=await createServerClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user) redirect("/login");
  const {data,error}=await db.rpc("get_setter_queue");
  if(error) {
    if(error.code==="42501") redirect("/setter-queue");
    throw new Error("Unable to load the setter queue");
  }
  const snapshot=queueSnapshotSchema.parse(data);
  if(!snapshot.is_manager) redirect("/setter-queue");
  const result=await db.rpc("get_setter_callback_report");
  if(result.error) throw new Error("Unable to load callback coverage report");
  return <QueueSettings snapshot={snapshot} report={callbackReportSchema.parse(result.data)} slaEnabled={process.env.SETTER_CALLBACK_SLA_ENABLED==="true"}/>;
}
