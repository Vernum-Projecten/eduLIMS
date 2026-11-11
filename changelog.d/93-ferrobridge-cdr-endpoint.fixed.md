- FerroBRIDGE starts in the production stack again: `compose.yaml` gives it
  the CDR address as `FERROBRIDGE__CDR__ENDPOINT__URL`, the key FerroBRIDGE
  0.0.24 accepts, where it refused the old `FERROBRIDGE__CDR__BASE_URL` and
  did not start. Upgrade step: take the new `compose.yaml`; an operator who
  set the old key in an override file renames it.
