import {MeasureWorkbench} from "./measure-workbench";

// Staff only: the (app) layout already requires a signed-in Manager or above.
export default function RoofMeasurePage() {
  return <MeasureWorkbench sandboxLinks={process.env.NODE_ENV === "development"} />;
}
