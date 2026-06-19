function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ResourceScheduler {
  private busy = false;

  async run<T>(task: () => Promise<T>): Promise<T> {
    while (this.busy) {
      await sleep(250);
    }

    this.busy = true;

    try {
      return await task();
    } finally {
      this.busy = false;
    }
  }
}

export const scheduler = new ResourceScheduler();
