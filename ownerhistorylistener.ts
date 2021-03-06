process.env.HFC_LOGGING = '{"off": "console"}';
import { Gateway, Wallets, ContractListener } from 'fabric-network';
import * as path from 'path';
import * as fs from 'fs';
import 'source-map-support/register';

interface Car {
    make:string;
    model:string;
    color:string;
    owner:string;
}

interface History {
    previousOwnerCount: number;
    previousOwners: string[];
    previousOwnershipChangeDates: string[];
    currentOwnershipChangeDate: string;
    currentOwner: string;
}

interface OwnerEvent {
  docType: string;
  transactionDate: string;
  carNumber: string;
  previousOwner: string;
  newOwner: string;
}
let finished:boolean;

let carid:string;
let ownerSequenceNum = 0;
const DELETED_CAR_OWNER_IDENTIFIER = 'CAR KEY DELETED';

async function main () {
  try {
    // The ID of the car to look up (can be overridden by the first command line argument)
    carid = (process.argv[2] !== undefined) ? process.argv[2] : 'CARXXXX'; // TODO change

    // Create a new file system based wallet for managing identities.
    const walletPath = path.join(process.cwd(), 'drivenet_wallet');
    const wallet = await Wallets.newFileSystemWallet(walletPath);

    // Create a new gateway for connecting to our peer node.
    const gateway:Gateway = new Gateway();
    const connectionProfilePath = path.resolve(__dirname, '..', 'CommunityMembers_profile.json');
    const connectionProfile = JSON.parse(fs.readFileSync(connectionProfilePath, 'utf8'));
    const connectionOptions = { wallet, identity: 'student', discovery: { enabled: true, asLocalhost: false } };
    await gateway.connect(connectionProfile, connectionOptions);

    // Get to the drivenet network and smart contract
    const network = await gateway.getNetwork('drivenet');
    const contract = network.getContract('fabcar');

    // First check that the car exists
    let existsBuffer:Buffer = await contract.evaluateTransaction('carExists', carid);
    if ((existsBuffer.toString()) === "false") {
      console.error(`Car "${carid}" doesn't exist`);
      return;
    }
    
    // Get current car details and owner history
    let carDetailsBuffer:Buffer = await contract.evaluateTransaction('queryCar', carid);
    const car: Car = JSON.parse(carDetailsBuffer.toString()) as Car;
    const previousOwnersBuffer = await contract.evaluateTransaction('getPreviousOwners', carid);
    const history: History = JSON.parse(previousOwnersBuffer.toString()) as History;
    console.log(`Owner history of ${carid} (currently ${car.color} ${car.make} ${car.model}):`);

    // Display the previous owners; start with the earliest owner.
    if (history.previousOwnerCount > 0) {
      for (let i=history.previousOwners.length-1; i>=0; i--) {
        const txTime = new Date(history.previousOwnershipChangeDates[i]).toUTCString();
        if (history.previousOwners[i] === DELETED_CAR_OWNER_IDENTIFIER) {
          console.log(`${txTime}: The car record was deleted`);
        } else {
          console.log(`${txTime}: ${history.previousOwners[i]} became owner #${(++ownerSequenceNum)}`);
        }
      }
    }

    // Display the current owner
    const txTime = new Date(history.currentOwnershipChangeDate).toUTCString();
    console.log(`${txTime}: ${history.currentOwner} became current owner #${(++ownerSequenceNum)}`);
    
    // Get ongoing notifications to our car from deleteCar, createCar and changeCarOwner transactions
    const listener: ContractListener = async (event) => {
      //console.log( 'chaincodeId: ', event.chaincodeId , ' eventName: ' , event.eventName , ' payload: ' , event.payload?.toString());
      handleEvent(event);
    };

    await contract.addContractListener(listener);
    finished=false;
    console.log('Listening for events...');
    while (!finished) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Disconnect from the gateway
    gateway.disconnect();

  } catch (error) {
    console.error('Failed to call transaction:', error.message);
    process.exit(0);
  }
}

void main();

function handleEvent (event:any) {
  // Filter to show events on our car only
  const ownerEvent: OwnerEvent = JSON.parse(event.payload) as OwnerEvent; // eslint-disable-line @typescript-eslint/no-unsafe-member-access
  if (ownerEvent.carNumber === carid) {
    const txTime = new Date(ownerEvent.transactionDate).toUTCString();
    if (ownerEvent.docType === 'deleteCarEvent') {
      console.log(`${txTime}: The car record was deleted`);
    } else {
      console.log(`${txTime}: ${ownerEvent.newOwner} became owner #${(++ownerSequenceNum)}`);
    }
  }
}
