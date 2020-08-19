/* Generated by ts-generator ver. 0.0.8 */
/* tslint:disable */

import { Contract, Signer } from "ethers";
import { Provider } from "@ethersproject/providers";

import { IFlashLoanReceiver } from "./IFlashLoanReceiver";

export class IFlashLoanReceiverFactory {
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): IFlashLoanReceiver {
    return new Contract(address, _abi, signerOrProvider) as IFlashLoanReceiver;
  }
}

const _abi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_reserve",
        type: "address"
      },
      {
        internalType: "address",
        name: "_destination",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "_fee",
        type: "uint256"
      },
      {
        internalType: "bytes",
        name: "_params",
        type: "bytes"
      }
    ],
    name: "executeOperation",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
];
