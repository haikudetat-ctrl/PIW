-- NJGIN returns both Polygon and MultiPolygon parcel boundaries. Keep the
-- geography column constrained to SRID 4326 while allowing either supported
-- areal geometry type.
alter table public.parcels
  alter column geometry
  type extensions.geography(geometry, 4326)
  using geometry::extensions.geography;
