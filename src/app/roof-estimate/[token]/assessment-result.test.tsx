import {StrictMode} from "react";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, test, vi} from "vitest";
import {getRoofAssessmentContext} from "@/config/roof-assessment";
import type {CalculationState, RoofAssessmentResponses} from "@/domain/roof-assessment";
import {AssessmentResult} from "./assessment-result";

const token="11111111-1111-4111-8111-111111111111";
const context=getRoofAssessmentContext("weather-report");
const responses: RoofAssessmentResponses={reason:"active_leak",roofAge:"15_20",conditionSignals:["active_leak","water_stains"],roofVisible:"yes",visibleCondition:"moderate_wear",stories:"two",complexityFeatures:["garage","multiple_levels"],priority:"reasonable_cost",timeline:"asap",ownership:"owner"};

function renderResult(calculation: CalculationState, fetch: typeof globalThis.fetch=vi.fn(async()=>Response.json({resultViewed:true}))) {
  vi.stubGlobal("fetch",fetch);
  return render(<AssessmentResult token={token} address="18 Harbor View Drive, Red Bank, NJ 07701" imageUrl="/campaigns/every-season.jpg" recommendation="professional_inspection" responses={responses} calculation={calculation} context={context}/>);
}

describe("assessment result payoff",()=>{
  afterEach(()=>vi.unstubAllGlobals());

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

  test("records one result view under React StrictMode",async()=>{
    const fetch=vi.fn(async()=>Response.json({resultViewed:true}));
    vi.stubGlobal("fetch",fetch);
    render(<StrictMode><AssessmentResult token={token} address="18 Harbor View Drive, Red Bank, NJ 07701" imageUrl="/campaigns/every-season.jpg" recommendation="professional_inspection" responses={responses} calculation={{status:"pending"}} context={context}/></StrictMode>);
    await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(`/api/roof-estimate/${token}/result-view`,{method:"POST"});
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
});
