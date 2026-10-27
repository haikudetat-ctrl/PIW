import {describe,expect,test} from "vitest";
import {deliverSetterCallbackAlerts,resolveSetterSlackClients,type CallbackAlert,type CallbackAlertRepository} from "./slack-alerts";

const companyA="b4000000-0000-4000-8000-000000000001";
const companyB="b4000000-0000-4000-8000-000000000002";
const bindings=[{companyId:companyA,webhookUrl:"https://hooks.slack.com/services/A/B/alpha"},{companyId:companyB,webhookUrl:"https://hooks.slack.com/services/C/D/bravo"}];

function repository(): CallbackAlertRepository & {states: Map<string,string>} {
  const states=new Map<string,string>();
  return {
    states,
    async claim(companyId) {
      if(states.has(companyId)) return [];
      states.set(companyId,"sending");
      return [{id:companyId,company_id:companyId,stage:"escalated",due_at:"2026-10-27T16:00:00Z",claim_token:companyId}];
    },
    async settle(alert: CallbackAlert,status) {states.set(alert.id,status);},
  };
}

describe("setter Slack bindings",()=>{
  test("two clients resolve to separate destinations",()=>{
    expect(resolveSetterSlackClients({SETTER_SLACK_CLIENTS_JSON:JSON.stringify(bindings)})).toEqual(bindings);
  });
  test.each([undefined,"broken",JSON.stringify([bindings[0],bindings[0]]),JSON.stringify([bindings[0],{...bindings[1],webhookUrl:bindings[0].webhookUrl}]),JSON.stringify([{companyId:companyA,webhookUrl:"https://example.com/services/A/B/C"}])])("invalid or ambiguous registry fails closed: %s",value=>{
    expect(resolveSetterSlackClients({SETTER_SLACK_CLIENTS_JSON:value})).toEqual([]);
  });
});

describe("callback alert delivery",()=>{
  test("keeps tenant destinations separate and records successful delivery",async()=>{
    const repo=repository(); const requests:Array<{url:string;body:string}>=[];
    const result=await deliverSetterCallbackAlerts({clients:bindings,repository:repo,fetchImpl:async(url,init)=>{
      requests.push({url:String(url),body:String(init?.body)}); return new Response("ok");
    }});
    expect(result).toEqual({sent:2,failed:0,uncertain:0});
    expect(requests).toEqual([
      {url:bindings[0].webhookUrl,body:JSON.stringify({text:`Callback needs coverage. Due 2026-10-27T16:00:00Z. Open the PIW setter queue. Alert ${companyA}.`})},
      {url:bindings[1].webhookUrl,body:JSON.stringify({text:`Callback needs coverage. Due 2026-10-27T16:00:00Z. Open the PIW setter queue. Alert ${companyB}.`})},
    ]);
    expect([...repo.states.values()]).toEqual(["sent","sent"]);
  });
  test("HTTP failure is recorded without an automatic retry",async()=>{
    const repo=repository(); let sends=0;
    const send=()=>deliverSetterCallbackAlerts({clients:[bindings[0]],repository:repo,fetchImpl:async()=>{sends++;return new Response("unavailable",{status:503});}});
    expect(await send()).toEqual({sent:0,failed:1,uncertain:0});
    expect(await send()).toEqual({sent:0,failed:0,uncertain:0});
    expect(sends).toBe(1); expect(repo.states.get(companyA)).toBe("failed");
  });
  test("lost response is uncertain and cannot be blindly sent again",async()=>{
    const repo=repository(); let sends=0;
    const send=()=>deliverSetterCallbackAlerts({clients:[bindings[0]],repository:repo,fetchImpl:async(_url,init)=>{
      sends++; expect(init?.signal).toBeInstanceOf(AbortSignal); expect(init?.redirect).toBe("error"); throw new Error("network contains sensitive destination");
    }});
    expect(await send()).toEqual({sent:0,failed:0,uncertain:1});
    await send(); expect(sends).toBe(1); expect(repo.states.get(companyA)).toBe("uncertain");
  });
  test("a repository returning the wrong company cannot send to another webhook",async()=>{
    const repo=repository(); repo.claim=async()=>[{id:companyB,company_id:companyB,stage:"missed",due_at:"2026-10-27T16:00:00Z",claim_token:companyB}];
    const result=await deliverSetterCallbackAlerts({clients:[bindings[0]],repository:repo,fetchImpl:async()=>{throw new Error("must not send");}});
    expect(result).toEqual({sent:0,failed:1,uncertain:0});
    expect(repo.states.get(companyB)).toBe("failed");
  });
});
