// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import {Errors} from '../helpers/Errors.sol';
import {DataTypes} from '../types/DataTypes.sol';

/**
 * @title UserConfiguration library
 * @author Aave
 * @notice Implements the bitmap logic to handle the user configuration
 */
library UserConfiguration {
  uint256 internal constant BORROWING_MASK =
    0x5555555555555555555555555555555555555555555555555555555555555555;

  /**
   * @dev Sets if the user is borrowing the reserve identified by reserveIndex
   * @param self The configuration object
   * @param reserveIndex The index of the reserve in the bitmap
   * @param borrowing True if the user is borrowing the reserve, false otherwise
   **/
  function setBorrowing(
    DataTypes.UserConfigurationMap storage self,
    uint256 reserveIndex,
    bool borrowing
  ) internal {
    require(reserveIndex < 10000, Errors.UL_INVALID_INDEX);
    uint256 dataIndex;
    for(uint256 reserveDataIndex = reserveIndex; reserveDataIndex>128; reserveDataIndex-=128){
      dataIndex++;
    }
    self.data[dataIndex] =
      (self.data[dataIndex] & ~(1 << (reserveIndex % 128 * 2))) |
      (uint256(borrowing ? 1 : 0) << (reserveIndex % 128 * 2));
  }

  /**
   * @dev Sets if the user is using as collateral the reserve identified by reserveIndex
   * @param self The configuration object
   * @param reserveIndex The index of the reserve in the bitmap
   * @param usingAsCollateral True if the user is usin the reserve as collateral, false otherwise
   **/
  function setUsingAsCollateral(
    DataTypes.UserConfigurationMap storage self,
    uint256 reserveIndex,
    bool usingAsCollateral
  ) internal {
    require(reserveIndex < 10000, Errors.UL_INVALID_INDEX);
    uint dataIndex;
    for(uint256 reserveDataIndex = reserveIndex; reserveDataIndex>128; reserveDataIndex-=128){
      dataIndex++;
    }
    self.data[dataIndex] =
      (self.data[dataIndex] & ~(1 << (reserveIndex % 128 * 2 + 1))) |
      (uint256(usingAsCollateral ? 1 : 0) << (reserveIndex % 128 * 2 + 1));
  }

  /**
   * @dev Used to validate if a user has been using the reserve for borrowing or as collateral
   * @param self The configuration object
   * @param reserveIndex The index of the reserve in the bitmap
   * @return True if the user has been using a reserve for borrowing or as collateral, false otherwise
   **/
  function isUsingAsCollateralOrBorrowing(
    DataTypes.UserConfigurationMap memory self,
    uint256 reserveIndex
  ) internal pure returns (bool) {
    require(reserveIndex < 10000, Errors.UL_INVALID_INDEX);
    uint256 dataIndex;
    for(uint256 reserveDataIndex = reserveIndex; reserveDataIndex > 128; reserveDataIndex-=128){
      dataIndex++;
    }
    if(reserveIndex>256){
      require(dataIndex>1, "fff");
    }
    return (self.data[dataIndex] >> (reserveIndex % 128 * 2)) & 3 != 0;
  }

  /**
   * @dev Used to validate if a user has been using the reserve for borrowing
   * @param self The configuration object
   * @param reserveIndex The index of the reserve in the bitmap
   * @return True if the user has been using a reserve for borrowing, false otherwise
   **/
  function isBorrowing(DataTypes.UserConfigurationMap memory self, uint256 reserveIndex)
    internal
    pure
    returns (bool)
  {
    require(reserveIndex < 10000, Errors.UL_INVALID_INDEX);
    uint256 dataIndex;
    for(uint256 reserveDataIndex = reserveIndex; reserveDataIndex>128; reserveDataIndex-=128){
      dataIndex++;
    }
    
    return (self.data[dataIndex] >> (reserveIndex % 128 * 2)) & 1 != 0;
  }

  /**
   * @dev Used to validate if a user has been using the reserve as collateral
   * @param self The configuration object
   * @param reserveIndex The index of the reserve in the bitmap
   * @return True if the user has been using a reserve as collateral, false otherwise
   **/
  function isUsingAsCollateral(DataTypes.UserConfigurationMap memory self, uint256 reserveIndex)
    internal
    pure
    returns (bool)
  {
    require(reserveIndex < 10000, Errors.UL_INVALID_INDEX);
    uint256 dataIndex;
    for(uint256 reserveDataIndex = reserveIndex; reserveDataIndex>128; reserveDataIndex-=128){
      dataIndex++;
    }
    return (self.data[dataIndex] >> (reserveIndex % 128 * 2 + 1)) & 1 != 0;
  }

  /**
   * @dev Used to validate if a user has been borrowing from any reserve
   * @param self The configuration object
   * @return True if the user has been borrowing any reserve, false otherwise
   **/
  function isBorrowingAny(DataTypes.UserConfigurationMap memory self) internal pure returns (bool) {
    for(uint i=0; i<79; i++){
      if(self.data[i] & BORROWING_MASK != 0){
        return true;
      }
    }
  }

  /**
   * @dev Used to validate if a user has not been using any reserve
   * @param self The configuration object
   * @return True if the user has been borrowing any reserve, false otherwise
   **/
  function isEmpty(DataTypes.UserConfigurationMap memory self) internal pure returns (bool) {
    return self.data[0] == 0;
  }
}
