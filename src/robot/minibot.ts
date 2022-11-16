import { WPILibWSRobotBase, DigitalChannelMode } from "@wpilib/wpilib-ws-robot";

import I2CErrorDetector from "../device-interfaces/i2c/i2c-error-detector";
import QueuedI2CBus, { QueuedI2CHandle } from "../device-interfaces/i2c/queued-i2c-bus";
import { NetworkTableInstance, NetworkTable, EntryListenerFlags } from "node-ntcore";
import LogUtil from "../utils/logging/log-util";

const logger = LogUtil.getLogger("minibot");

export default class WPILibWSRomiRobot extends WPILibWSRobotBase {
    private _queuedBus: QueuedI2CBus;
    private _i2cHandle: QueuedI2CHandle;

    private _batteryPct: number = 0;

    private _heartbeatTimer: NodeJS.Timeout;
    private _readTimer: NodeJS.Timeout;

    private _readyP: Promise<void>;
    private _i2cErrorDetector: I2CErrorDetector = new I2CErrorDetector(10, 500, 100);

    // Keep track of the number of active WS connections
    private _numWsConnections: number = 0;

    // Keep track of whether or not the robot is DS enabled/disabled
    private _dsEnabled: boolean = false;

    // Keep track of the DS heartbeat
    private _dsHeartbeatPresent: boolean = false;

    private _statusNetworkTable: NetworkTable;
    private _configNetworkTable: NetworkTable;

    // Take in the abstract bus, since this will allow us to
    // write unit tests more easily
    constructor(bus: QueuedI2CBus, address: number) {
        super();

        const ntInstance = NetworkTableInstance.getDefault();
        this._statusNetworkTable = ntInstance.getTable("/minibot/Status");
        this._configNetworkTable = ntInstance.getTable("/minibot/Config");

        // By default, we'll use a queued I2C bus
        this._queuedBus = bus;
        this._i2cHandle = this._queuedBus.getNewAddressedHandle(address, true);

        // Configure the onboard hardware
	//
	// setup PCA chip here

        // Set up NT interfaces
        this._configureNTInterface();

        // Set up the ready indicator
        this._readyP =
            this._configureDevices()
            .then(() => {
                this._resetToCleanState();

                // Set up the heartbeat. Only send the heartbeat if we have
                // an active WS connection, the robot is in enabled state
                // AND we have a recent-ish DS packet
                this._heartbeatTimer = setInterval(() => {this._setRomiHeartBeat();}, 100 );

            })
            .catch(err => {
                logger.error("Failed to initialize robot: ", err);
            });
    }

    public readyP(): Promise<void> {
        return this._readyP;
    }

    public get descriptor(): string {
        return "4143 minibot";
    }

    public setPWMValue(channel: number, value: number): void {
        if (channel < 0) {
            return;
        }


	    // We get the value in the range 0-255 but the romi
	    // expects -400 to 400
	    // Positive values here correspond to forward motion
	    const Value = Math.floor(((value / 255) * 800) - 400);

	    // We need to do some trickery to get a twos-complement number
	    // Essentially we'll write a 16 bit signed int to the buffer
	    // and read it out as an unsigned int
	    // Mainly to work around the fact that the i2c-bus library's
	    // writeBlock() doesn't work...
	    const tmp = Buffer.alloc(2);
	    tmp.writeInt16BE(Value);

	    this._i2cHandle.writeWord(offset, tmp.readUInt16BE())
	    .catch(err => {
		this._i2cErrorDetector.addErrorInstance();
	    });
    }

    /**
     * Called when a new WebSocket connection occurs
     */
    public onWSConnection(remoteAddrV4?: string): void {
        // If this is the first WS connection
        if (this._numWsConnections === 0) {
        }

        this._numWsConnections++;

        logger.info(`New WS Connection from ${remoteAddrV4}`);
        this.emit("wsConnection", {
            remoteAddrV4
        });
    }

    /**
     * Called when a WebSocket disconnects
     */
    public onWSDisconnection(): void {
        this._numWsConnections--;

        // If this was our last disconnection, clear out all the state
        if (this._numWsConnections === 0) {
            console.log("[minibot] Lost all connections, resetting state");
            this._resetToCleanState();
            this.emit("wsNoConnections");
        }
    }

    public onRobotEnabled(): void {
        logger.info("Robot ENABLED");
        this._dsEnabled = true;
        // To ensure Romi will act on signals sent immediately
        this._setRomiHeartBeat();
    }

    public onRobotDisabled(): void {
        logger.info("Robot DISABLED");
        this._dsEnabled = false;
    }

    public onDSPacketTimeoutOccurred(): void {
        logger.warn("DS Packet Heartbeat Lost");
        this._dsHeartbeatPresent = false;
    }

    public onDSPacketTimeoutCleared(): void {
        logger.info("DS Packet Heartbeat Acquired");
        this._dsHeartbeatPresent = true;
    }

    /**
     * Configure all devices on the Romi
     * This includes setting up the appropriate IO port->device/port pairs
     */
    private async _configureDevices(): Promise<void> {
    }

    /**
     * Resets the Romi to a known clean state
     * This does NOT reset any IO configuration
     */
    private _resetToCleanState(): void {

        // Reset our ds enabled state
        this._dsEnabled = false;
    }

    private _configureNTInterface() {
    }
}
