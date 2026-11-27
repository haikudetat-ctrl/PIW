import {getRoofMeasurement, listRoofMeasurements, saveRoofMeasurement, searchJobs} from "./actions";
import {MeasureWorkbench} from "./measure-workbench";

// Staff only: the (app) layout already requires a signed-in Manager or above.
export default async function RoofMeasurePage({searchParams}: {searchParams: Promise<{m?: string}>}) {
  const {m} = await searchParams;
  const saved = m && /^[0-9a-f-]{36}$/i.test(m) ? await getRoofMeasurement(m) : null;
  return (
    <>
      {saved && !saved.ok ? (
        <p role="alert" className="border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-800">{saved.error}</p>
      ) : null}
      <MeasureWorkbench
        sandboxLinks={process.env.NODE_ENV === "development"}
        storage={{save: saveRoofMeasurement, list: listRoofMeasurements, searchJobs}}
        initialSaved={saved?.ok ? saved.value : null}
      />
    </>
  );
}
