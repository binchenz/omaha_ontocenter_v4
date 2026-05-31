import { surfacesFor, isDesignTimeUser, SURFACE, PERMISSION } from './surface';

describe('surfacesFor', () => {
  it('grants only the consume surface to a query-only operator', () => {
    expect(surfacesFor(['object.read', 'object.query'])).toEqual([SURFACE.CONSUME]);
  });

  it('grants consume + maintain + create to a design-time user', () => {
    expect(surfacesFor([PERMISSION.ONTOLOGY_DESIGN])).toEqual([
      SURFACE.CONSUME,
      SURFACE.MAINTAIN,
      SURFACE.CREATE,
    ]);
  });

  it('grants every surface (including pipeline) to a wildcard admin', () => {
    expect(surfacesFor([PERMISSION.WILDCARD])).toEqual([
      SURFACE.CONSUME,
      SURFACE.MAINTAIN,
      SURFACE.CREATE,
      SURFACE.PIPELINE,
    ]);
  });

  it('grants only consume when permissions are empty', () => {
    expect(surfacesFor([])).toEqual([SURFACE.CONSUME]);
  });
});

describe('isDesignTimeUser', () => {
  it('is false for a query-only operator', () => {
    expect(isDesignTimeUser(['object.read', 'object.query'])).toBe(false);
  });

  it('is true when the user holds a design-time permission', () => {
    expect(isDesignTimeUser([PERMISSION.ONTOLOGY_DESIGN])).toBe(true);
  });
});
