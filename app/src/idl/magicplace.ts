/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/magicplace.json`.
 */
export type Magicplace = {
  "address": "CHhht9A6W95JYGm3AA1yH34n112uexmrpKqoSwKwfmxE",
  "metadata": {
    "name": "magicplace",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "commitShard",
      "docs": [
        "Commit shard state from ER to base layer"
      ],
      "discriminator": [
        85,
        249,
        246,
        67,
        192,
        89,
        165,
        50
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "shard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "shardX"
              },
              {
                "kind": "arg",
                "path": "shardY"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "shardX",
          "type": "u16"
        },
        {
          "name": "shardY",
          "type": "u16"
        }
      ]
    },
    {
      "name": "erasePixel",
      "docs": [
        "Erase a pixel (set to 0/transparent)"
      ],
      "discriminator": [
        6,
        38,
        248,
        220,
        47,
        82,
        57,
        222
      ],
      "accounts": [
        {
          "name": "shard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "shardX"
              },
              {
                "kind": "arg",
                "path": "shardY"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "shardX",
          "type": "u16"
        },
        {
          "name": "shardY",
          "type": "u16"
        },
        {
          "name": "px",
          "type": "u32"
        },
        {
          "name": "py",
          "type": "u32"
        }
      ]
    },
    {
      "name": "initializeShard",
      "docs": [
        "Initialize a shard at (shard_x, shard_y) coordinates and delegate to ER",
        "Shards are created on-demand when a user wants to paint in that region",
        "shard_x, shard_y: 0-4095 (4096 shards per dimension)",
        "After initialization, the shard is automatically delegated to Ephemeral Rollups"
      ],
      "discriminator": [
        100,
        96,
        88,
        58,
        225,
        178,
        9,
        147
      ],
      "accounts": [
        {
          "name": "shard",
          "docs": [
            "The shard account to initialize"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "shardX"
              },
              {
                "kind": "arg",
                "path": "shardY"
              }
            ]
          }
        },
        {
          "name": "authority",
          "docs": [
            "The authority paying for initialization and delegation"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                167,
                183,
                223,
                207,
                199,
                14,
                206,
                3,
                154,
                170,
                74,
                197,
                117,
                125,
                32,
                89,
                54,
                49,
                88,
                141,
                30,
                85,
                95,
                170,
                252,
                208,
                96,
                129,
                53,
                227,
                237,
                67
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "shardX"
              },
              {
                "kind": "arg",
                "path": "shardY"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "CHhht9A6W95JYGm3AA1yH34n112uexmrpKqoSwKwfmxE"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        }
      ],
      "args": [
        {
          "name": "shardX",
          "type": "u16"
        },
        {
          "name": "shardY",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initializeUser",
      "discriminator": [
        111,
        17,
        185,
        250,
        60,
        122,
        38,
        254
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "Session account PDA derived from the MAIN wallet (not session key)",
            "This ensures each main wallet has exactly one session account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "mainWallet"
              }
            ]
          }
        },
        {
          "name": "authority",
          "docs": [
            "The session key that is authorized to act on behalf of main_wallet"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "bufferPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                167,
                183,
                223,
                207,
                199,
                14,
                206,
                3,
                154,
                170,
                74,
                197,
                117,
                125,
                32,
                89,
                54,
                49,
                88,
                141,
                30,
                85,
                95,
                170,
                252,
                208,
                96,
                129,
                53,
                227,
                237,
                67
              ]
            }
          }
        },
        {
          "name": "delegationRecordPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pda"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "pda",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "mainWallet"
              }
            ]
          }
        },
        {
          "name": "instructionsSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "ownerProgram",
          "address": "CHhht9A6W95JYGm3AA1yH34n112uexmrpKqoSwKwfmxE"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        }
      ],
      "args": [
        {
          "name": "mainWallet",
          "type": "pubkey"
        },
        {
          "name": "signature",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "placePixel",
      "docs": [
        "Place a pixel using global coordinates",
        "px, py: 0 to 524,287 (global pixel coordinates)",
        "color: 1-15 (0 is reserved for unset/transparent, 4-bit packing)"
      ],
      "discriminator": [
        178,
        40,
        167,
        97,
        31,
        149,
        219,
        143
      ],
      "accounts": [
        {
          "name": "shard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "shardX"
              },
              {
                "kind": "arg",
                "path": "shardY"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "shardX",
          "type": "u16"
        },
        {
          "name": "shardY",
          "type": "u16"
        },
        {
          "name": "px",
          "type": "u32"
        },
        {
          "name": "py",
          "type": "u32"
        },
        {
          "name": "color",
          "type": "u8"
        }
      ]
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer"
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "pixelShard",
      "discriminator": [
        71,
        74,
        139,
        167,
        18,
        144,
        148,
        25
      ]
    },
    {
      "name": "sessionAccount",
      "discriminator": [
        74,
        34,
        65,
        133,
        96,
        163,
        80,
        69
      ]
    }
  ],
  "events": [
    {
      "name": "pixelChanged",
      "discriminator": [
        140,
        76,
        21,
        27,
        179,
        226,
        1,
        84
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidShardCoord",
      "msg": "Invalid shard coordinates: must be 0-4095"
    },
    {
      "code": 6001,
      "name": "invalidPixelCoord",
      "msg": "Invalid pixel coordinates: must be 0-524287"
    },
    {
      "code": 6002,
      "name": "shardMismatch",
      "msg": "Shard coordinates don't match pixel location"
    },
    {
      "code": 6003,
      "name": "invalidColor",
      "msg": "Invalid color: must be 1-15 (4-bit)"
    },
    {
      "code": 6004,
      "name": "invalidAuth",
      "msg": "Invalid authentication"
    }
  ],
  "types": [
    {
      "name": "pixelChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "px",
            "type": "u32"
          },
          {
            "name": "py",
            "type": "u32"
          },
          {
            "name": "color",
            "type": "u8"
          },
          {
            "name": "painter",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pixelShard",
      "docs": [
        "A single shard of the pixel canvas",
        "Each shard stores 16,384 pixels (128×128 grid) using 4-bit packed colors = ~8KB",
        "Up to 16,777,216 shards (4096×4096 grid) can cover the full 524,288×524,288 canvas",
        "Shards are created on-demand when users paint in new regions"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "shardX",
            "docs": [
              "Shard X coordinate (0-4095)"
            ],
            "type": "u16"
          },
          {
            "name": "shardY",
            "docs": [
              "Shard Y coordinate (0-4095)"
            ],
            "type": "u16"
          },
          {
            "name": "pixels",
            "docs": [
              "Pixel data - 4-bit packed storage (2 pixels per byte)",
              "Byte index = pixel_id / 2",
              "Even pixels in high nibble (bits 4-7), odd pixels in low nibble (bits 0-3)",
              "Value = color_index (0 = unset/transparent, 1-15 = palette colors)"
            ],
            "type": "bytes"
          },
          {
            "name": "creator",
            "docs": [
              "Creator of the shard (who paid for initialization)"
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "sessionAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mainAddress",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "ownedShards",
            "type": "u64"
          },
          {
            "name": "cooldownCounter",
            "type": "u8"
          },
          {
            "name": "lastPlaceTimestamp",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
