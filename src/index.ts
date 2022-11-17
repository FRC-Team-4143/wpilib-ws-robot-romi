#!/usr/bin/env node
import fs from "fs";
import path from "path";
import WPILibWSminibot from "./robot/minibot";
import { WPILibWSRobotEndpoint, WPILibWSServerConfig, WPILibWSClientConfig } from "@wpilib/wpilib-ws-robot";
import I2CPromisifiedBus from "./device-interfaces/i2c/i2c-connection";
import program from "commander";
import ServiceConfiguration, { EndpointType } from "./service-config";
import ProgramArguments from "./program-arguments";
import RestInterface from "./services/rest-interface/rest-interface";
import DSServer from "./services/ds-interface/ds-ip-server";
import QueuedI2CBus from "./device-interfaces/i2c/queued-i2c-bus";
import { NetworkTableInstance } from "node-ntcore";
import { execSync } from "child_process";
import LogUtil, { LogLevel } from "./utils/logging/log-util";

// INITIAL SETUP
const mainLogger = LogUtil.getLogger("MAIN");
const configLogger = LogUtil.getLogger("CONFIG");
const restLogger = LogUtil.getLogger("SVC-REST");
const i2cLogger = LogUtil.getLogger("I2C");

let packageVersion: string = "0.0.0";

const packageJsonPath = path.resolve(__dirname, "../package.json");

try {
    // Read in package.json to get version information
    const packageJsonContents = fs.readFileSync(packageJsonPath);
    const packageJsonObj = JSON.parse(packageJsonContents.toString());
    if (packageJsonObj.version !== undefined) {
        packageVersion = packageJsonObj.version;
    }
}
catch (e) {
    mainLogger.error("Error reading package.json: " + e.message);
    mainLogger.error(e.stack);
}

// Set up command line options
program
    .version(packageVersion)
    .name("wpilibws-minibot")
    .option("-c, --config <file>", "configuration file")
    .option("-e, --endpoint-type <type>", "endpoint type (client/server)", "server")
    .option("-p, --port <port>", "port to listen/connect to")
    .option("-h, --host <host>", "host to connect to (required for client)")
    .option("-u, --uri <uri>", "websocket URI")
    .helpOption("--help", "display help for command");

program.parse(process.argv);

mainLogger.info(`Version: ${packageVersion}`);

let serviceConfig: ServiceConfiguration;

try {
    serviceConfig = new ServiceConfiguration(program as ProgramArguments);
}
catch (err) {
    mainLogger.error(err.message);
    process.exit();
}

const I2C_BUS_NUM: number = 1;

// Set up the i2c bus out here
let i2cBus: I2CPromisifiedBus;
let endpoint: WPILibWSRobotEndpoint;

const HardwareI2C = require("./device-interfaces/i2c/hw-i2c").default;
i2cBus = new HardwareI2C(I2C_BUS_NUM);

// Set up the queued bus
const queuedI2CBus: QueuedI2CBus =  new QueuedI2CBus(i2cBus);

// Set up network tables
let ntConnected = false;
const ntInstance: NetworkTableInstance = NetworkTableInstance.getDefault();
ntInstance.setNetworkIdentity("minibot-nt-client");

// Set default log level
ntInstance.setLogLevel(LogLevel.info);

const miniTable = ntInstance.getTable("/Minibot");
const miniInfoTable = miniTable.getSubTable("Information");
const miniStatusTable = miniTable.getSubTable("Status");


// Get the CPU Serial number, similar to how the default SSID is obtained
let piIdent: string = "WPILibPi-UNKNOWN";

try {
    const piIdentBuf = execSync("grep ^Serial /proc/cpuinfo | cut -d ':' -f 2 | cut -c 10-");
    const identString = piIdentBuf.toString();

    if (identString !== "") {
        piIdent = "WPILibPi-" + identString;
    }
}
catch (err) {}

// Populate the Romi/Information group
miniInfoTable.getEntry("Identifier").setString(piIdent);
miniInfoTable.getEntry("Service Version").setString(packageVersion);

const robot: WPILibWSminibot = new WPILibWSminibot(queuedI2CBus, 0x14);

if (serviceConfig.endpointType === EndpointType.SERVER) {
    const serverSettings: WPILibWSServerConfig = {
        port: serviceConfig.port,
        uri: serviceConfig.uri
    };

    endpoint = WPILibWSRobotEndpoint.createServerEndpoint(robot, serverSettings);
    configLogger.info(`Mode: Server, Port: ${serviceConfig.port}, URI: ${serviceConfig.uri}`);
}
else {
    const clientSettings: WPILibWSClientConfig = {
        hostname: serviceConfig.host,
        port: serviceConfig.port,
        uri: serviceConfig.uri
    };

    endpoint = WPILibWSRobotEndpoint.createClientEndpoint(robot, clientSettings);
    configLogger.info(`Mode: Client, Host: ${serviceConfig.host}, Port: ${serviceConfig.port}, URI: ${serviceConfig.uri}`);
}

// Set up the REST interface
const restInterface: RestInterface = new RestInterface();
restInterface.addStatusQuery("service-version", () => {
    return {
        serviceVersion: packageVersion
    };
});

restInterface.addStatusQuery("battery-status", () => {
    return {
        voltage: robot.getBatteryPercentage() * 9.0,
        percent: robot.getBatteryPercentage()
    };
});

const dsServer: DSServer = new DSServer();
dsServer.start();

robot.on("wsConnection", (remoteConnectionInfo) => {
    dsServer.updateRobotCodeIpV4Addr(remoteConnectionInfo.remoteAddrV4);

    // Update the NT client to point to the new IP
    ntInstance.setServer(remoteConnectionInfo.remoteAddrV4);
    if (!ntConnected) {
        mainLogger.info("Starting NT Client");
        ntInstance.startClient(remoteConnectionInfo.remoteAddrV4);
        ntConnected = true;
    }
});

robot.on("wsNoConnections", () => {
    dsServer.updateRobotCodeIpV4Addr(null);

    // if (ntConnected) {
    //     console.log("[NT] Stopping Client");
    //     ntInstance.stopClient();
    //     ntConnected = false;
    // }
});

endpoint.startP()
.then(() => {
    mainLogger.info(`Endpoint (${serviceConfig.endpointType}) Started`);
})
.then(() => {
    restLogger.info("Endpoints:");
    restInterface.getEndpoints().forEach(accessor => {
        restLogger.info(`${accessor}`);
    });

    restInterface.start();
})
