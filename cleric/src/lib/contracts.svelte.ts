// Persistent contracts-page state.
// Declared at module level so it survives tab switches (route unmounts).

export interface ConstructorArg {
  name: string;
  arg_type: string;
}

export interface ContractEntry {
  name: string;
  kind: string;
  constructor_args: ConstructorArg[];
}

export interface SolFile {
  filename: string;
  path: string;
  contracts: ContractEntry[];
}

export type DeployState = "idle" | "compiling" | "deploying" | "error" | "deployed";

export interface SelectedContract {
  order: number;
  name: string;
  kind: string;
  filename: string;
  filePath: string;
  constructorArgs: ConstructorArg[];
  argValues: Record<string, string>;
  deployState: DeployState;
  deployError?: string;
  deployed: boolean;
  // Set when the contract's source file is edited after a successful deploy,
  // so the UI can offer a redeploy.
  stale?: boolean;
  address?: string;
  txHash?: string;
  blockNumber?: number;
  // Compiled ABI, kept after deploy so the Tests tab can list callable functions.
  abi?: any[];
}

class ContractsStore {
  folderPath    = $state("");
  solFiles      = $state<SolFile[]>([]);
  scanning      = $state(false);
  scanError     = $state("");
  selected      = $state<SelectedContract[]>([]);
  expandedDeploy = $state<Record<string, boolean>>({});
}

export const contractsStore = new ContractsStore();
