import assert from "node:assert/strict";
import { getStrongNotifications } from "../assets/js/notification.js";

const ordinary = { primaryDirection: "做多" };
const strong = { primaryDirection: "強烈做多" };
assert.deepEqual(getStrongNotifications({ signals: [ordinary, strong] }), [strong]);

console.log("notification check ok");
