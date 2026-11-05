import Link from "next/link";
import {redirect} from "next/navigation";
import {createServerClient} from "@/lib/supabase/server";
import {queueSnapshotSchema} from "@/modules/setter-queue/schema";
import {SignOutButton} from "@/app/(app)/sign-out-button";
import {QueueWorkspace} from "./queue-workspace";

export default async function SetterQueuePage() {
  const db=await createServerClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user) redirect("/login");
  const {data,error}=await db.rpc("get_setter_queue");
  if(error) {
    if(error.code!=="42501") throw new Error("Unable to load the setter queue");
    return <main className="admin-theme min-h-screen bg-surface-muted p-8 text-ink"><h1 className="text-2xl font-semibold">Setter queue access</h1>
      <p className="mt-3">Ask a manager to enroll your account in this company&apos;s setter team.</p><Link href="/" className="mt-4 inline-block text-tint underline">Back to dashboard</Link><div className="mt-6"><SignOutButton/></div></main>;
  }
  const snapshot=queueSnapshotSchema.parse(data);
  return <QueueWorkspace snapshot={snapshot} signOut={<SignOutButton/>}/>;
}
