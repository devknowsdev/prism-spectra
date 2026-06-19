import { ValidationError } from './errors';
import type { ExecutionResult } from '../types/contracts';

export class RuntimeValidator {
  validate(result: ExecutionResult): void {
    if (!result.output || result.output.trim().length === 0) {
      throw new ValidationError('Execution produced empty output');
    }

    if (!result.modelUsed) {
      throw new ValidationError('Execution did not record modelUsed');
    }
  }
}

export const runtimeValidator = new RuntimeValidator();
