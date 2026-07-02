import { AVC_VERTICAL } from './avc.vertical';

describe('AVC vertical — manifest (ADR-0062)', () => {
  it('declares a stable name', () => {
    expect(AVC_VERTICAL.name).toBe('avc');
  });
});
