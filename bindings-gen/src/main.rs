fn main() -> Result<(), Box<dyn std::error::Error>> {
    bindings_gen::run_from_env()
}
