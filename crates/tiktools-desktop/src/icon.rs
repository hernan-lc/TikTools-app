/// RGBA pixels shared by the native window and system tray icon.
///
/// Winit and tray-icon both accept raw RGBA data, while the WebView uses the
/// app mark in `src/web/icon.svg` as its favicon. Keeping the native pixels in
/// one place prevents the title-bar/taskbar icon and tray icon from drifting
/// apart.
pub(crate) const SIZE: u32 = 32;

pub(crate) fn rgba() -> Vec<u8> {
    let mut pixels = vec![0_u8; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let offset = ((y * SIZE + x) * 4) as usize;
            let dx = x as f32 - 15.5;
            let dy = y as f32 - 15.5;
            if dx * dx + dy * dy > 14.5 * 14.5 {
                continue;
            }
            let amount = (x + y) as f32 / 62.0;
            pixels[offset] = (254.0 - 80.0 * amount) as u8;
            pixels[offset + 1] = (44.0 + 200.0 * amount) as u8;
            pixels[offset + 2] = (85.0 + 150.0 * amount) as u8;
            pixels[offset + 3] = 255;
            if (9..=22).contains(&x) && (9..=20).contains(&y) {
                pixels[offset] = 255;
                pixels[offset + 1] = 255;
                pixels[offset + 2] = 255;
            }
        }
    }
    pixels
}
