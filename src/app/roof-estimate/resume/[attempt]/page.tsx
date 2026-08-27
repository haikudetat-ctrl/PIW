import type {Metadata} from "next";
import {ResumeVerificationForm} from "./resume-verification-form";

export const metadata: Metadata = {
  title: "Secure assessment access | All Season",
  robots: {index: false, follow: false},
};

export default async function ResumeAssessmentPage({
  params,
}: {
  params: Promise<{attempt: string}>;
}) {
  const {attempt} = await params;
  return <ResumeVerificationForm attemptId={attempt} />;
}
