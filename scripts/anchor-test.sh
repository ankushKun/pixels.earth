#!/bin/bash

# kill any existing validators
# pkill -f solana-test-validator

# run tests
anchor test  --provider.cluster localnet --skip-local-validator