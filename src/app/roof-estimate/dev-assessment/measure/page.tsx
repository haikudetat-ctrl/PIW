import {notFound} from "next/navigation";
import {MeasureWorkbench} from "./measure-workbench";

export default function RoofMeasurePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <MeasureWorkbench />;
}
