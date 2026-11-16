import { randomInt } from "node:crypto";
import type { Server } from "node:http";

// An OS-customized ephemeral range can include Fetch-blocked ports (e.g.10080).
// Allocate automatic HTTP listeners in the high dynamic range instead; never
// disable Fetch's port protection or retry an application request.
export async function listenLoopback(server: Server, port = 0): Promise<void> {
  for (let attempt = 0; attempt < 32; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => {
          server.off("listening", ready);
          reject(error);
        };
        const ready = () => {
          server.off("error", fail);
          resolve();
        };
        server.once("error", fail);
        server.once("listening", ready);
        try {
          server.listen(port || randomInt(49152, 65536), "127.0.0.1");
        } catch (error) {
          server.off("error", fail);
          server.off("listening", ready);
          reject(error);
        }
      });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows can refuse a port that Hyper-V/WinNAT reserved or excluded, and
      // an ephemeral port can be taken between the pick and the bind. Both are
      // "try another automatic port"; a fixed port and every other error are not.
      const retryable = code === "EADDRINUSE" || code === "EACCES";
      if (port !== 0 || !retryable || attempt === 31) throw error;
    }
  }
}
