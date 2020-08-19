/* Generated by ts-generator ver. 0.0.8 */
/* tslint:disable */

import { Signer, BytesLike } from "ethers";
import { Provider, TransactionRequest } from "@ethersproject/providers";
import {
  Contract,
  ContractFactory,
  PayableOverrides
} from "@ethersproject/contracts";

import { UpgradeabilityProxy } from "./UpgradeabilityProxy";

export class UpgradeabilityProxyFactory extends ContractFactory {
  constructor(signer?: Signer) {
    super(_abi, _bytecode, signer);
  }

  deploy(
    _logic: string,
    _data: BytesLike,
    overrides?: PayableOverrides
  ): Promise<UpgradeabilityProxy> {
    return super.deploy(_logic, _data, overrides || {}) as Promise<
      UpgradeabilityProxy
    >;
  }
  getDeployTransaction(
    _logic: string,
    _data: BytesLike,
    overrides?: PayableOverrides
  ): TransactionRequest {
    return super.getDeployTransaction(_logic, _data, overrides || {});
  }
  attach(address: string): UpgradeabilityProxy {
    return super.attach(address) as UpgradeabilityProxy;
  }
  connect(signer: Signer): UpgradeabilityProxyFactory {
    return super.connect(signer) as UpgradeabilityProxyFactory;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): UpgradeabilityProxy {
    return new Contract(address, _abi, signerOrProvider) as UpgradeabilityProxy;
  }
}

const _abi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_logic",
        type: "address"
      },
      {
        internalType: "bytes",
        name: "_data",
        type: "bytes"
      }
    ],
    stateMutability: "payable",
    type: "constructor"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "implementation",
        type: "address"
      }
    ],
    name: "Upgraded",
    type: "event"
  },
  {
    stateMutability: "payable",
    type: "fallback"
  }
];

const _bytecode =
  "0x60806040526040516103d93803806103d98339818101604052604081101561002657600080fd5b81516020830180516040519294929383019291908464010000000082111561004d57600080fd5b90830190602082018581111561006257600080fd5b825164010000000081118282018810171561007c57600080fd5b82525081516020918201929091019080838360005b838110156100a9578181015183820152602001610091565b50505050905090810190601f1680156100d65780820380516001836020036101000a031916815260200191505b5060408181527f656970313936372e70726f78792e696d706c656d656e746174696f6e0000000082525190819003601c01902060008051602061037e83398151915260001990910114925061012a91505057fe5b61013c826001600160e01b036101fb16565b8051156101f4576000826001600160a01b0316826040518082805190602001908083835b6020831061017f5780518252601f199092019160209182019101610160565b6001836020036101000a038019825116818451168082178552505050505050905001915050600060405180830381855af49150503d80600081146101df576040519150601f19603f3d011682016040523d82523d6000602084013e6101e4565b606091505b50509050806101f257600080fd5b505b5050610297565b61020e8161025b60201b6100201760201c565b6102495760405162461bcd60e51b815260040180806020018281038252603b81526020018061039e603b913960400191505060405180910390fd5b60008051602061037e83398151915255565b6000813f7fc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a47081811480159061028f57508115155b949350505050565b60d9806102a56000396000f3fe6080604052600a600c565b005b6012601e565b601e601a605b565b6080565b565b6000813f7fc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470818114801590605357508115155b949350505050565b7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5490565b3660008037600080366000845af43d6000803e808015609e573d6000f35b3d6000fdfea264697066735822122078b035d3c57ddfba6e77114686949c1e21a1ae33d623e8e859c1875faf2915eb64736f6c63430006080033360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc43616e6e6f742073657420612070726f787920696d706c656d656e746174696f6e20746f2061206e6f6e2d636f6e74726163742061646472657373";
