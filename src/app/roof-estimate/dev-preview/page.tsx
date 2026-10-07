import {notFound} from "next/navigation";
import {PreviewSandbox} from "./preview-sandbox";

export default function PreviewSandboxPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PreviewSandbox />;
}
