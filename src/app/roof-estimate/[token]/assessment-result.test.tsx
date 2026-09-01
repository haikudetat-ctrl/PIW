import {StrictMode} from "react";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, test, vi} from "vitest";
import {getRoofAssessmentContext} from "@/config/roof-assessment";
import type {CalculationState, RoofAssessmentResponses} from "@/domain/roof-assessment";
import {AssessmentResult} from "./assessment-result";

const {trackConversion} = vi.hoisted(() => ({trackConversion: vi.fn()}));
vi.mock("@/components/marketing/meta-pixel-provider", () => ({
  useMetaPixel: () => ({trackConversion}),
}));

const token="11111111-1111-4111-8111-111111111111";
const context=getRoofAssessmentContext("weather-report");
const responses: RoofAssessmentResponses={reason:"active_leak",roofAge:"15_20",conditionSignals:["active_leak","water_stains"],roofVisible:"yes",visibleCondition:"moderate_wear",stories:"two",complexityFeatures:["garage","multiple_levels"],priority:"reasonable_cost",timeline:"asap",ownership:"owner"};

function renderResult(calculation: CalculationState, fetch: typeof globalThis.fetch=vi.fn(async()=>Response.json({resultViewed:true}))) {
  vi.stubGlobal("fetch",fetch);
  return render(<AssessmentResult token={token} address="18 Harbor View Drive, Red Bank, NJ 07701" imageUrl="/campaigns/every-season.jpg" recommendation="professional_inspection" responses={responses} calculation={calculation} context={context}/>);
}

describe("assessment result payoff",()=>{
  afterEach(()=>{
    vi.unstubAllGlobals();
    trackConversion.mockReset();
  });

  test.each([
    [{status:"pending"} as const,"Finalizing your property calculation"],
    [{status:"review_required",reason:"low_confidence"} as const,"A professional is reviewing the property"],
  ])("keeps the campaign-framed outlook visible without serializing a range for %o",(calculation,stateHeading)=>{
    const {container}=renderResult(calculation);
    expect(screen.getByRole("heading",{name:context.resultHeadline})).toBeVisible();
    expect(screen.getByText(context.resultIntro)).toBeVisible();
    expect(screen.getByText(stateHeading)).toBeVisible();
    expect(screen.getByText("Prompt professional review")).toBeVisible();
    expect(container.innerHTML).not.toMatch(/\$[0-9]|1800000|2600000|23(?:\.0)? squares/i);
  });

  test("renders a trustworthy Google range and measurement",()=>{
    renderResult({status:"ready",source:"google",lowCents:1_800_000,highCents:2_600_000,roofSquares:23,generatedAt:"2026-08-26T12:00:00.000Z"});
    expect(screen.getByText("$18,000")).toBeVisible();
    expect(screen.getByText("$26,000")).toBeVisible();
    expect(screen.getByText(/23\.0 measured roofing squares/)).toBeVisible();
  });

  test("renders the three package payoff and exclusions before consultation",()=>{
    const {container}=renderResult({
      status:"ready",source:"google",lowCents:2_375_000,highCents:3_000_000,roofSquares:25,
      generatedAt:"2026-08-31T12:00:00.000Z",pricingVersion:"all-season-nj-2026-v1",
      packages:[
        {tierKey:"good",displayOrder:1,customerName:"Complete System",customerDescription:"Dependable complete roofing system.",warrantySummary:"Enhanced manufacturer protection.",differentiators:["Architectural finish"],lowCentsPerSquare:80000,highCentsPerSquare:97500,recommended:false,measuredRoofSquares:25,rangeLowCents:2000000,rangeHighCents:2437500,pricingVersion:"all-season-nj-2026-v1",generatedAt:"2026-08-31T12:00:00.000Z"},
        {tierKey:"better",displayOrder:2,customerName:"Recommended",customerDescription:"Upgraded protection and appearance.",warrantySummary:"Extended material and workmanship coverage.",differentiators:["Upgraded material weight"],lowCentsPerSquare:95000,highCentsPerSquare:120000,recommended:true,measuredRoofSquares:25,rangeLowCents:2375000,rangeHighCents:3000000,pricingVersion:"all-season-nj-2026-v1",generatedAt:"2026-08-31T12:00:00.000Z"},
        {tierKey:"best",displayOrder:3,customerName:"Signature System",customerDescription:"Premium finish and protection.",warrantySummary:"Extended workmanship coverage.",differentiators:["Impact protection"],lowCentsPerSquare:125000,highCentsPerSquare:165000,recommended:false,measuredRoofSquares:25,rangeLowCents:3125000,rangeHighCents:4125000,pricingVersion:"all-season-nj-2026-v1",generatedAt:"2026-08-31T12:00:00.000Z"},
      ],
      adjustments:[{code:"decking_sheet",label:"Decking replacement",explanation:"Only where field inspection confirms it is needed.",calculationKind:"per_unit",lowValue:95,highValue:150,displayOrder:1}],
    });
    expect(screen.getByRole("heading",{name:"Complete System"})).toBeVisible();
    expect(screen.getByRole("heading",{name:"Recommended"})).toBeVisible();
    expect(screen.getByRole("heading",{name:"Signature System"})).toBeVisible();
    expect(screen.getByLabelText("Recommended package")).toBeVisible();
    expect(screen.getByText("$20,000")).toBeVisible();
    expect(screen.getByText("$41,250")).toBeVisible();
    expect(screen.getByText("If replacement is confirmed after inspection")).toBeVisible();
    const disclosure=screen.getByText("Decking replacement");
    const consultation=screen.getByRole("button",{name:"Get a professional roof assessment"});
    expect(disclosure.compareDocumentPosition(consultation)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).not.toMatch(/CertainTeed|Landmark|NorthGate|Presidential|Grand Manor|ShingleMaster/i);
  });

  test("records one result view under React StrictMode",async()=>{
    const fetch=vi.fn(async()=>Response.json({resultViewed:true,metaEvent:null}));
    vi.stubGlobal("fetch",fetch);
    render(<StrictMode><AssessmentResult token={token} address="18 Harbor View Drive, Red Bank, NJ 07701" imageUrl="/campaigns/every-season.jpg" recommendation="professional_inspection" responses={responses} calculation={{status:"pending"}} context={context}/></StrictMode>);
    await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(`/api/roof-estimate/${token}/result-view`,{method:"POST"});
  });

  test("emits the server-issued AssessmentCompleted envelope only after the result acknowledgement",async()=>{
    const envelope={name:"AssessmentCompleted" as const,eventId:"99999999-9999-4999-8999-999999999999",issuedAt:"2026-09-01T16:05:00.000Z"};
    renderResult({status:"pending"},vi.fn(async()=>Response.json({resultViewed:true,metaEvent:envelope})));
    await waitFor(()=>expect(trackConversion).toHaveBeenCalledWith(envelope));
  });

  test("keeps the quote visible when acknowledgement or Meta delivery is unavailable",async()=>{
    renderResult({status:"pending"},vi.fn(async()=>Response.json({error:"unavailable"},{status:503})));
    expect(screen.getByText("Finalizing your property calculation")).toBeVisible();
    await waitFor(()=>expect(trackConversion).not.toHaveBeenCalled());
  });

  test("opens inline preferences, validates call window, and confirms success",async()=>{
    const fetch=vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith("result-view")?Response.json({resultViewed:true}):Response.json({status:"requested",contactMethod:"call",callWindow:"morning",timezone:"America/New_York"}));
    renderResult({status:"pending"},fetch);
    fireEvent.click(screen.getByRole("button",{name:"Get a professional roof assessment"}));
    expect(screen.getByRole("group",{name:"How should we follow up?"})).toBeVisible();
    fireEvent.click(screen.getByRole("radio",{name:"Call me"}));
    fireEvent.click(screen.getByRole("button",{name:"Request my consultation"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose the best Eastern Time window");
    fireEvent.click(screen.getByRole("radio",{name:/Morning/}));
    fireEvent.click(screen.getByRole("button",{name:"Request my consultation"}));
    expect(await screen.findByText(/We’ll call during your selected morning window/i)).toBeVisible();
  });

  test("preserves selection and announces a failure",async()=>{
    const fetch=vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith("result-view")?Response.json({resultViewed:true}):Response.json({error:"unavailable"},{status:503}));
    renderResult({status:"pending"},fetch);
    fireEvent.click(screen.getByRole("button",{name:"Get a professional roof assessment"}));
    fireEvent.click(screen.getByRole("radio",{name:"Text me"}));
    fireEvent.click(screen.getByRole("button",{name:"Request my consultation"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not save your preference");
    expect(screen.getByRole("radio",{name:"Text me"})).toBeChecked();
  });

  test.each([
    [{},"missing fields"],
    [{status:"requested",contactMethod:"email",callWindow:null,timezone:"America/New_York"},"mismatched canonical preference"],
    [{status:"requested",contactMethod:"text",callWindow:null,timezone:"America/New_York",requestId:token},"extra internal field"],
  ] as Array<[unknown,string]>)('retains controls when a 2xx response has $1',async(body)=>{
    const fetch=vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith("result-view")?Response.json({resultViewed:true}):Response.json(body));
    renderResult({status:"pending"},fetch);
    fireEvent.click(screen.getByRole("button",{name:"Get a professional roof assessment"}));
    fireEvent.click(screen.getByRole("radio",{name:"Text me"}));
    fireEvent.click(screen.getByRole("button",{name:"Request my consultation"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not save your preference");
    expect(screen.getByRole("radio",{name:"Text me"})).toBeChecked();
  });
});
