import {notFound} from "next/navigation";
import {PreviewSandbox, type SandboxScreen} from "./preview-sandbox";

const SCREENS: SandboxScreen[] = ["preview", "address", "loading", "price", "review"];

export default async function PreviewSandboxPage({searchParams}: {searchParams: Promise<{screen?: string}>}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const {screen} = await searchParams;
  return <PreviewSandbox screen={SCREENS.find((value) => value === screen) ?? "preview"} />;
}
