-- Initial seed data for Live Streaming E-commerce Platform
-- Seed: 001_initial_data

-- Insert admin user
INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, email_verified, email_verified_at) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'admin@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/VcSAg/9qm', 'Admin', 'User', 'admin', true, true, CURRENT_TIMESTAMP);

-- Insert sample customers
INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, email_verified, email_verified_at) VALUES
('550e8400-e29b-41d4-a716-446655440001', 'customer1@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/VcSAg/9qm', 'John', 'Doe', 'customer', true, true, CURRENT_TIMESTAMP),
('550e8400-e29b-41d4-a716-446655440002', 'customer2@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/VcSAg/9qm', 'Jane', 'Smith', 'customer', true, true, CURRENT_TIMESTAMP);

-- Insert sample vendor users
INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, email_verified, email_verified_at) VALUES
('550e8400-e29b-41d4-a716-446655440003', 'vendor1@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/VcSAg/9qm', 'Alice', 'Johnson', 'vendor', true, true, CURRENT_TIMESTAMP),
('550e8400-e29b-41d4-a716-446655440004', 'vendor2@example.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/VcSAg/9qm', 'Bob', 'Wilson', 'vendor', true, true, CURRENT_TIMESTAMP);

-- Insert sample vendors
INSERT INTO vendors (id, user_id, business_name, business_type, description, is_verified, is_active) VALUES
('660e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440003', 'Fashion Forward', 'Fashion & Apparel', 'Premium fashion and lifestyle products', true, true),
('660e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440004', 'Tech Gadgets Pro', 'Electronics', 'Latest technology and gadgets', true, true);

-- Insert sample categories
INSERT INTO categories (id, name, slug, description, is_active) VALUES
('770e8400-e29b-41d4-a716-446655440001', 'Fashion', 'fashion', 'Clothing, accessories, and fashion items', true),
('770e8400-e29b-41d4-a716-446655440002', 'Electronics', 'electronics', 'Technology, gadgets, and electronic devices', true),
('770e8400-e29b-41d4-a716-446655440003', 'Home & Garden', 'home-garden', 'Home decor, furniture, and garden supplies', true),
('770e8400-e29b-41d4-a716-446655440004', 'Sports & Fitness', 'sports-fitness', 'Sports equipment and fitness gear', true);

-- Insert subcategories
INSERT INTO categories (id, name, slug, description, parent_id, is_active) VALUES
('770e8400-e29b-41d4-a716-446655440005', 'Mens Clothing', 'mens-clothing', 'Clothing for men', '770e8400-e29b-41d4-a716-446655440001', true),
('770e8400-e29b-41d4-a716-446655440006', 'Womens Clothing', 'womens-clothing', 'Clothing for women', '770e8400-e29b-41d4-a716-446655440001', true),
('770e8400-e29b-41d4-a716-446655440007', 'Smartphones', 'smartphones', 'Mobile phones and accessories', '770e8400-e29b-41d4-a716-446655440002', true),
('770e8400-e29b-41d4-a716-446655440008', 'Laptops', 'laptops', 'Laptops and computers', '770e8400-e29b-41d4-a716-446655440002', true);

-- Insert sample products
INSERT INTO products (id, vendor_id, category_id, name, slug, description, short_description, sku, price, compare_price, inventory_quantity, images, tags, is_active, is_featured) VALUES
('880e8400-e29b-41d4-a716-446655440001', '660e8400-e29b-41d4-a716-446655440001', '770e8400-e29b-41d4-a716-446655440005', 'Premium Cotton T-Shirt', 'premium-cotton-t-shirt', 'High-quality cotton t-shirt with comfortable fit and premium materials. Perfect for casual wear and everyday comfort.', 'Premium cotton t-shirt for everyday comfort', 'FF-TSHIRT-001', 29.99, 39.99, 100, '["https://example.com/images/tshirt1.jpg", "https://example.com/images/tshirt2.jpg"]', ARRAY['fashion', 'clothing', 'cotton', 'casual'], true, true),
('880e8400-e29b-41d4-a716-446655440002', '660e8400-e29b-41d4-a716-446655440001', '770e8400-e29b-41d4-a716-446655440006', 'Designer Dress', 'designer-dress', 'Elegant designer dress perfect for special occasions. Made with premium fabrics and attention to detail.', 'Elegant designer dress for special occasions', 'FF-DRESS-001', 149.99, 199.99, 50, '["https://example.com/images/dress1.jpg", "https://example.com/images/dress2.jpg"]', ARRAY['fashion', 'dress', 'designer', 'elegant'], true, true),
('880e8400-e29b-41d4-a716-446655440003', '660e8400-e29b-41d4-a716-446655440002', '770e8400-e29b-41d4-a716-446655440007', 'Latest Smartphone', 'latest-smartphone', 'Cutting-edge smartphone with advanced features, high-quality camera, and long-lasting battery life.', 'Advanced smartphone with premium features', 'TGP-PHONE-001', 699.99, 799.99, 25, '["https://example.com/images/phone1.jpg", "https://example.com/images/phone2.jpg"]', ARRAY['electronics', 'smartphone', 'mobile', 'technology'], true, true),
('880e8400-e29b-41d4-a716-446655440004', '660e8400-e29b-41d4-a716-446655440002', '770e8400-e29b-41d4-a716-446655440008', 'Gaming Laptop', 'gaming-laptop', 'High-performance gaming laptop with powerful graphics card, fast processor, and premium display.', 'High-performance gaming laptop', 'TGP-LAPTOP-001', 1299.99, 1499.99, 15, '["https://example.com/images/laptop1.jpg", "https://example.com/images/laptop2.jpg"]', ARRAY['electronics', 'laptop', 'gaming', 'computer'], true, false);

-- Insert product variants
INSERT INTO product_variants (id, product_id, name, sku, price, inventory_quantity, options) VALUES
('990e8400-e29b-41d4-a716-446655440001', '880e8400-e29b-41d4-a716-446655440001', 'Small - Black', 'FF-TSHIRT-001-S-BLK', 29.99, 30, '{"size": "S", "color": "Black"}'),
('990e8400-e29b-41d4-a716-446655440002', '880e8400-e29b-41d4-a716-446655440001', 'Medium - Black', 'FF-TSHIRT-001-M-BLK', 29.99, 40, '{"size": "M", "color": "Black"}'),
('990e8400-e29b-41d4-a716-446655440003', '880e8400-e29b-41d4-a716-446655440001', 'Large - Black', 'FF-TSHIRT-001-L-BLK', 29.99, 30, '{"size": "L", "color": "Black"}'),
('990e8400-e29b-41d4-a716-446655440004', '880e8400-e29b-41d4-a716-446655440002', 'Small - Red', 'FF-DRESS-001-S-RED', 149.99, 15, '{"size": "S", "color": "Red"}'),
('990e8400-e29b-41d4-a716-446655440005', '880e8400-e29b-41d4-a716-446655440002', 'Medium - Red', 'FF-DRESS-001-M-RED', 149.99, 20, '{"size": "M", "color": "Red"}'),
('990e8400-e29b-41d4-a716-446655440006', '880e8400-e29b-41d4-a716-446655440002', 'Large - Red', 'FF-DRESS-001-L-RED', 149.99, 15, '{"size": "L", "color": "Red"}');

-- Insert sample streams
INSERT INTO streams (id, vendor_id, title, description, stream_key, status, scheduled_at, tags) VALUES
('aa0e8400-e29b-41d4-a716-446655440001', '660e8400-e29b-41d4-a716-446655440001', 'Fashion Show Live', 'Live fashion show featuring our latest collection', 'stream_key_fashion_001', 'scheduled', CURRENT_TIMESTAMP + INTERVAL '1 day', ARRAY['fashion', 'live', 'show']),
('aa0e8400-e29b-41d4-a716-446655440002', '660e8400-e29b-41d4-a716-446655440002', 'Tech Product Launch', 'Launching our newest tech products live', 'stream_key_tech_001', 'scheduled', CURRENT_TIMESTAMP + INTERVAL '2 days', ARRAY['technology', 'launch', 'products']);

-- Insert sample videos
INSERT INTO videos (id, vendor_id, title, description, video_url, thumbnail_url, duration, status, tags) VALUES
('bb0e8400-e29b-41d4-a716-446655440001', '660e8400-e29b-41d4-a716-446655440001', 'Summer Collection Preview', 'Quick preview of our summer fashion collection', 'https://example.com/videos/summer-collection.mp4', 'https://example.com/thumbnails/summer-collection.jpg', 45, 'ready', ARRAY['fashion', 'summer', 'collection']),
('bb0e8400-e29b-41d4-a716-446655440002', '660e8400-e29b-41d4-a716-446655440002', 'Smartphone Review', 'Detailed review of our latest smartphone features', 'https://example.com/videos/smartphone-review.mp4', 'https://example.com/thumbnails/smartphone-review.jpg', 120, 'ready', ARRAY['technology', 'smartphone', 'review']);

-- Link products to streams
INSERT INTO stream_products (stream_id, product_id, sort_order) VALUES
('aa0e8400-e29b-41d4-a716-446655440001', '880e8400-e29b-41d4-a716-446655440001', 1),
('aa0e8400-e29b-41d4-a716-446655440001', '880e8400-e29b-41d4-a716-446655440002', 2),
('aa0e8400-e29b-41d4-a716-446655440002', '880e8400-e29b-41d4-a716-446655440003', 1),
('aa0e8400-e29b-41d4-a716-446655440002', '880e8400-e29b-41d4-a716-446655440004', 2);

-- Link products to videos
INSERT INTO video_products (video_id, product_id, timestamp_start, timestamp_end) VALUES
('bb0e8400-e29b-41d4-a716-446655440001', '880e8400-e29b-41d4-a716-446655440001', 10, 25),
('bb0e8400-e29b-41d4-a716-446655440001', '880e8400-e29b-41d4-a716-446655440002', 30, 45),
('bb0e8400-e29b-41d4-a716-446655440002', '880e8400-e29b-41d4-a716-446655440003', 15, 90),
('bb0e8400-e29b-41d4-a716-446655440002', '880e8400-e29b-41d4-a716-446655440004', 95, 120);