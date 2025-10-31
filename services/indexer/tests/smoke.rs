#[test]
fn binary_exits_successfully_in_oneshot_mode() {
    let mut cmd = assert_cmd::cargo::cargo_bin_cmd!("indexer");
    cmd.env("INDEXER_RUN_MODE", "oneshot");
    cmd.assert().success();
}
