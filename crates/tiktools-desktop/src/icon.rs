/// RGBA pixels shared by the native window and system tray icon.
///
/// Winit and tray-icon both accept raw RGBA data, while the WebView uses the
/// app mark in `src/web/icon.svg` as its favicon. Keeping the native pixels in
/// one place prevents the title-bar/taskbar icon and tray icon from drifting
/// apart.
///
/// The artwork mirrors the web mark: a rounded square with a diagonal
/// pink-purple-cyan gradient and a white chat bubble. Everything is computed
/// per pixel so no image asset needs shipping beside the executable.
pub(crate) const SIZE: u32 = 32;

const PINK: [f32; 3] = [254.0, 44.0, 85.0];
const PURPLE: [f32; 3] = [168.0, 85.0, 247.0];
const CYAN: [f32; 3] = [37.0, 244.0, 238.0];
const WHITE: [f32; 3] = [255.0, 255.0, 255.0];

pub(crate) fn rgba() -> Vec<u8> {
    let mut pixels = vec![0_u8; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let offset = ((y * SIZE + x) * 4) as usize;
            let (red, green, blue, alpha) = pixel(x, y);
            pixels[offset] = red;
            pixels[offset + 1] = green;
            pixels[offset + 2] = blue;
            pixels[offset + 3] = alpha;
        }
    }
    pixels
}

fn pixel(x: u32, y: u32) -> (u8, u8, u8, u8) {
    let px = x as f32 + 0.5;
    let py = y as f32 + 0.5;
    // Rounded-square background with a one-pixel feathered edge.
    let background = rounded_rect_sdf(px, py, 2.0, 2.0, 30.0, 30.0, 8.0);
    if background > 0.5 {
        return (0, 0, 0, 0);
    }
    let amount = ((x + y) as f32 / 62.0).clamp(0.0, 1.0);
    let [red, green, blue] = gradient(amount);
    // White chat bubble with a tail, drawn over the gradient.
    let bubble = rounded_rect_sdf(px, py, 9.0, 10.0, 23.0, 21.0, 3.5).min(triangle_sdf(
        px,
        py,
        (12.0, 20.0),
        (9.5, 25.5),
        (17.0, 20.0),
    ));
    if bubble <= 0.0 {
        // Brand dot from the web mark, pinned to the bubble's upper right.
        let dx = px - 21.0;
        let dy = py - 12.5;
        if dx * dx + dy * dy <= 1.8 * 1.8 {
            return (PINK[0] as u8, PINK[1] as u8, PINK[2] as u8, 255);
        }
        return (WHITE[0] as u8, WHITE[1] as u8, WHITE[2] as u8, 255);
    }
    let alpha = ((0.5 - background).clamp(0.0, 1.0) * 255.0) as u8;
    (red as u8, green as u8, blue as u8, alpha)
}

/// Diagonal brand gradient: pink through purple to cyan.
fn gradient(amount: f32) -> [f32; 3] {
    if amount < 0.5 {
        lerp_color(PINK, PURPLE, amount * 2.0)
    } else {
        lerp_color(PURPLE, CYAN, (amount - 0.5) * 2.0)
    }
}

fn lerp_color(from: [f32; 3], to: [f32; 3], amount: f32) -> [f32; 3] {
    [
        from[0] + (to[0] - from[0]) * amount,
        from[1] + (to[1] - from[1]) * amount,
        from[2] + (to[2] - from[2]) * amount,
    ]
}

/// Signed distance to a rounded rectangle; negative inside.
fn rounded_rect_sdf(px: f32, py: f32, x0: f32, y0: f32, x1: f32, y1: f32, radius: f32) -> f32 {
    let cx = (x0 + x1) / 2.0;
    let cy = (y0 + y1) / 2.0;
    let qx = (px - cx).abs() - ((x1 - x0) / 2.0 - radius);
    let qy = (py - cy).abs() - ((y1 - y0) / 2.0 - radius);
    (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt() + qx.max(qy).min(0.0) - radius
}

/// Negative inside the triangle, positive outside.
fn triangle_sdf(px: f32, py: f32, a: (f32, f32), b: (f32, f32), c: (f32, f32)) -> f32 {
    let sign = |p: (f32, f32), q: (f32, f32), r: (f32, f32)| {
        (p.0 - r.0) * (q.1 - r.1) - (q.0 - r.0) * (p.1 - r.1)
    };
    let p = (px, py);
    let d1 = sign(p, a, b);
    let d2 = sign(p, b, c);
    let d3 = sign(p, c, a);
    let inside = (d1 < 0.0 && d2 < 0.0 && d3 < 0.0) || (d1 > 0.0 && d2 > 0.0 && d3 > 0.0);
    if inside {
        -1.0
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel_at(pixels: &[u8], x: u32, y: u32) -> [u8; 4] {
        let offset = ((y * SIZE + x) * 4) as usize;
        [
            pixels[offset],
            pixels[offset + 1],
            pixels[offset + 2],
            pixels[offset + 3],
        ]
    }

    #[test]
    fn icon_has_expected_size_and_transparent_corners() {
        let pixels = rgba();
        assert_eq!(pixels.len(), (SIZE * SIZE * 4) as usize);
        assert_eq!(pixel_at(&pixels, 0, 0)[3], 0);
        assert_eq!(pixel_at(&pixels, 31, 31)[3], 0);
    }

    #[test]
    fn icon_shows_gradient_bubble_and_brand_dot() {
        let pixels = rgba();
        // Top-left gradient is pinkish, bottom-right is cyanish.
        // (Interior pixels: the rounded corners are feathered.)
        let top_left = pixel_at(&pixels, 7, 3);
        let bottom_right = pixel_at(&pixels, 24, 28);
        assert_eq!(top_left[3], 255);
        assert_eq!(bottom_right[3], 255);
        assert!(top_left[0] > 200 && top_left[1] < 120);
        assert!(bottom_right[1] > 150 && bottom_right[2] > 150);
        // Bubble body is white, brand dot is pink.
        assert_eq!(pixel_at(&pixels, 15, 15), [255, 255, 255, 255]);
        assert_eq!(pixel_at(&pixels, 21, 12), [254, 44, 85, 255]);
    }
}
