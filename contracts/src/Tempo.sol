// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITIP20} from "./interfaces/ITIP20.sol";
import {ITIP20Factory} from "./interfaces/ITIP20Factory.sol";
import {ITIP403Registry} from "./interfaces/ITIP403Registry.sol";

/// Precompile addresses, the same on every Tempo network.
library Tempo {
    ITIP20 internal constant PATH_USD = ITIP20(0x20C0000000000000000000000000000000000000);
    ITIP20Factory internal constant TIP20_FACTORY = ITIP20Factory(0x20Fc000000000000000000000000000000000000);
    ITIP403Registry internal constant TIP403_REGISTRY = ITIP403Registry(0x403c000000000000000000000000000000000000);

    uint8 internal constant WHITELIST = 0;
    uint8 internal constant BLACKLIST = 1;
}
