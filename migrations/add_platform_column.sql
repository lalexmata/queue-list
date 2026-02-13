-- Add platform column to queue_items table
ALTER TABLE queue_items 
ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'unknown';

-- Create index for faster filtering by platform
CREATE INDEX IF NOT EXISTS idx_queue_items_platform ON queue_items(platform);

-- Update existing rows to have 'unknown' as platform
UPDATE queue_items SET platform = 'unknown' WHERE platform IS NULL;
