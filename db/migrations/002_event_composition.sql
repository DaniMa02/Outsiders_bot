-- Composiciones alternativas para eventos con roles (ej: Hardcore 4+1+1+1+1 vs 5+1+1+1)
-- 0 = composición A (por defecto: 4 DD + Debuffer)
-- 1 = composición B (5 DD, sin Debuffer)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS composition SMALLINT DEFAULT 0
  CHECK (composition IN (0, 1));
