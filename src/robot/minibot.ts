import { WPILibWSRobotBase, DigitalChannelMode } from "@wpilib/wpilib-ws-robot";

//import I2CErrorDetector from "../device-interfaces/i2c/i2c-error-detector";
//import QueuedI2CBus, { QueuedI2CHandle } from "../device-interfaces/i2c/queued-i2c-bus";
import { NetworkTableInstance, NetworkTable, EntryListenerFlags } from "node-ntcore";
import LogUtil from "../utils/logging/log-util";

const logger = LogUtil.getLogger("minibot");
import * as i2cBus from "i2c-bus";
import Pca9685Driver from "pca9685";

// PCA9685 options
const options =
{
    i2c: i2cBus.openSync(1),
    address: 0x40, // default value
    frequency: 50, // default value
    debug: true
};

export default class WPILibWSminibot extends WPILibWSRobotBase {
   //private _queuedBus: QueuedI2CBus;
   //private _i2cHandle: QueuedI2CHandle;

    private _batteryPct: number = 0;

    private _heartbeatTimer: NodeJS.Timeout;
    private _readTimer: NodeJS.Timeout;

    private _readyP: Promise<void>;
    //private _i2cErrorDetector: I2CErrorDetector = new I2CErrorDetector(10, 500, 100);

    // Keep track of the number of active WS connections
    private _numWsConnections: number = 0;

    // Keep track of whether or not the robot is DS enabled/disabled
    private _dsEnabled: boolean = false;

    // Keep track of the DS heartbeat
    private _dsHeartbeatPresent: boolean = false;

    private _statusNetworkTable: NetworkTable;
    private _configNetworkTable: NetworkTable;
    private _pwm: Pca9685Driver;

    // Take in the abstract bus, since this will allow us to
    // write unit tests more easily
    //constructor(bus: QueuedI2CBus, address: number) {
    constructor() {
        super();

        const ntInstance = NetworkTableInstance.getDefault();
        this._statusNetworkTable = ntInstance.getTable("/minibot/Status");
        this._configNetworkTable = ntInstance.getTable("/minibot/Config");

        // By default, we'll use a queued I2C bus
	//this._queuedBus = bus;
	//this._i2cHandle = this._queuedBus.getNewAddressedHandle(address, true);

        // Configure the onboard hardware
	//
	// setup PCA chip here
	this._pwm = new Pca9685Driver(options, function startLoop(err: any): void {
	    if (err) {
       		 console.error("Error initializing PCA9685");
       		 process.exit(-1);
	    }
	});


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
                //this._heartbeatTimer = setInterval(() => {this._setRomiHeartBeat();}, 100 );

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


	    // We get the value in the range 0-255 
	    const Value = Math.floor(((value / 255) * 1000) + 1500);

	    this._pwm.setPulseLength(channel, Value);

	    // We need to do some trickery to get a twos-complement number
	    // Essentially we'll write a 16 bit signed int to the buffer
	    // and read it out as an unsigned int
	    // Mainly to work around the fact that the i2c-bus library's
	    // writeBlock() doesn't work...

	    //const on_offset = 40 + 6 + (channel * 4);
	    //this._i2cHandle.writeWord(on_offset, 0)
	    //.catch(err => {
	    //		this._i2cErrorDetector.addErrorInstance();
	    //});

	    //const tmp = Buffer.alloc(2);
	    //tmp.writeInt16BE(Value);
	    //const off_offset = 40 + 8 + (channel * 4);
	    //this._i2cHandle.writeWord(off_offset, tmp.readUInt16BE())
	    //.catch(err => {
	    //	this._i2cErrorDetector.addErrorInstance();
	    //});
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
        //this._setRomiHeartBeat();
    }

    public getAnalogInVoltage(channel: number): number {
        return 0.0;
    }

    public setAnalogOutVoltage(channel: number, voltage: number): void {
        return;
    }

    public setDigitalChannelMode(channel: number, mode: DigitalChannelMode): void {
        return;
    }

    public setEncoderReverseDirection(channel: number, reverse: boolean): void {
        return;
    }

    public getEncoderPeriod(channel: number): number {
        return 0;
    }

    public getEncoderCount(channel: number): number {
        return 0;
    }

    public getDIOValue(channel: number): boolean {
        return false;
    }

    public setDIOValue(channel: number, value: boolean): void {
        return;
    }

    public resetEncoder(channel: number, keepLast?: boolean): void {
        return;
    }

    public onRobotDisabled(): void {
        logger.info("Robot DISABLED");
        this._dsEnabled = false;
        this._pwm.allChannelsOff();
    }

    public onDSPacketTimeoutOccurred(): void {
        logger.warn("DS Packet Heartbeat Lost");
        this._dsHeartbeatPresent = false;
        this._pwm.allChannelsOff();
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
        this._pwm.allChannelsOff();

        // Reset our ds enabled state
        this._dsEnabled = false;
    }

    private _configureNTInterface() {
    }
}
