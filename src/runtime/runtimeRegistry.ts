import type { ExecutionContext } from './executionContext';

export class RuntimeRegistry {
  private executions = new Map<string, ExecutionContext>();
  register(context: ExecutionContext): void { this.executions.set(context.executionId, context); }
  update(id: string, context: ExecutionContext): void { this.executions.set(id, context); }
  remove(id: string): void { this.executions.delete(id); }
  get(id: string): ExecutionContext | undefined { return this.executions.get(id); }
  list(): ExecutionContext[] { return [...this.executions.values()]; }
}

export const runtimeRegistry = new RuntimeRegistry();