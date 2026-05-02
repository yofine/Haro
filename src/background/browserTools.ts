import type {
  AgentEvent,
  BenchmarkToolRequest,
  BenchmarkToolResult,
  ModelGateway
} from "../shared/types";
import { benchmarkRequestToBrowserToolPlan } from "../browser-tools/benchmarkAdapter";
import { executeBrowserToolPlan, type BrowserToolDebugger } from "../browser-tools/planExecutor";
import type { BrowserToolPlan } from "../browser-tools/types";
export { sanitizeReportHtml } from "../browser-tools/html";

type RunBenchmarkToolInput = {
  request: BenchmarkToolRequest;
  tools: BrowserToolDebugger;
  modelGateway: ModelGateway;
  onToolPlan?: (plan: BrowserToolPlan) => void;
  onEvent?: (event: AgentEvent) => void;
};

type RunBrowserToolPlanInput = {
  plan: BrowserToolPlan;
  tools: BrowserToolDebugger;
  modelGateway: ModelGateway;
  onToolPlan?: (plan: BrowserToolPlan) => void;
  onEvent?: (event: AgentEvent) => void;
};

export async function runBenchmarkTool({ request, tools, modelGateway, onToolPlan, onEvent }: RunBenchmarkToolInput): Promise<BenchmarkToolResult> {
  const plan = benchmarkRequestToBrowserToolPlan(request);
  onToolPlan?.(plan);
  return executeBrowserToolPlan({ plan, tools, modelGateway, onEvent });
}

export async function runBrowserToolPlan({ plan, tools, modelGateway, onToolPlan, onEvent }: RunBrowserToolPlanInput): Promise<BenchmarkToolResult> {
  onToolPlan?.(plan);
  return executeBrowserToolPlan({ plan, tools, modelGateway, onEvent });
}
