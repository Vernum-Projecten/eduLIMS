- The deploy bundle ships `config/ferroehr.toml.example`, a reference FerroEHR
  configuration with authentication on and eduLIMS declared as the system
  client `edulims-ferroehr`. Copy it to `config/ferroehr.toml`, fill in your
  identity provider's issuer, your institution, your lab and the CDR's system
  identifier, and check it with
  `docker compose run --rm --no-deps ferroehr config check` (Q-SEC-1, B3).
