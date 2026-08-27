import {notFound} from "next/navigation";
import {AssessmentSandbox} from "./assessment-sandbox";

export default function AssessmentSandboxPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <AssessmentSandbox />;
}
