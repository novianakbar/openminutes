// @novnc/novnc tidak menyediakan type declarations — deklarasi minimal untuk
// permukaan API yang dipakai BotLiveView (lihat docs/API.md di paket noVNC).
declare module "@novnc/novnc" {
  interface RFBOptions {
    shared?: boolean;
    credentials?: { username?: string; password?: string; target?: string };
  }

  export default class RFB extends EventTarget {
    constructor(target: Element, url: string, options?: RFBOptions);

    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    background: string;

    disconnect(): void;

    addEventListener(
      type: "connect" | "disconnect" | "securityfailure" | "credentialsrequired",
      listener: (ev: CustomEvent<{ clean?: boolean; reason?: string }>) => void,
    ): void;
  }
}
