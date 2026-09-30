import { Stamper } from '../../../infra/stamper';

/** HTML's [[Detached]] marker, carried by the transferred implementation instance. */
export class DetachedTransferableStamper extends Stamper {
  #detached: undefined;

  private constructor(implInst: object) {
    super(implInst);
  }

  static stamp(implInst: object): void {
    if (!(#detached in implInst)) new DetachedTransferableStamper(implInst);
  }

  static has(implInst: object): boolean {
    return #detached in implInst;
  }
}
