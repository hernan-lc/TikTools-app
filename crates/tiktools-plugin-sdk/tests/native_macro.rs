use tiktools_plugin_sdk::prelude::*;

#[derive(Default)]
struct NativeExample;

impl Plugin for NativeExample {}

tiktools_export_native_plugin!(NativeExample);

#[test]
fn native_macro_exports_a_compatible_table() {
    let api = tiktools_plugin_init();
    assert!(!api.is_null());
    assert!(unsafe { &*api }.is_compatible());
}
