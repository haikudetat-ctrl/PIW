import {createServerClient} from "@/lib/supabase/server";
import {smsPanelSchema} from "@/modules/sms/approved-schema";
import {approvedSmsReady} from "@/modules/sms/approved-runtime";
import {TextingControls} from "./texting-controls";
export default async function TextingSettingsPage(){
 const db=await createServerClient();const {data,error}=await db.rpc("get_sms_control_panel");const parsed=smsPanelSchema.safeParse(data);
 if(error||!parsed.success)return <main><h2 className="text-2xl font-bold">Texting unavailable</h2><p className="mt-2 text-sm text-ink-muted">Texting setup could not be loaded. Reload this page or ask 2Stack to check the database migration.</p></main>;
 const panel=parsed.data;
 return <TextingControls panel={panel} ready={approvedSmsReady(panel.company_id)} automationRunning={process.env.SMS_AUTOMATION_ENABLED==="true"}/>;
}
