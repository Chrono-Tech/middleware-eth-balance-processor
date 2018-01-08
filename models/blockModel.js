/**
 * Mongoose model. Represents a block in eth
 * @module models/blockModel
 * @returns {Object} Mongoose model
 */

const mongoose = require('mongoose'),
  config = require('../config');

const Block = new mongoose.Schema({
  block: {type: Number},
  network: {type: String},
  created: {type: Date, required: true, default: Date.now}
});

module.exports = mongoose.model(`${config.mongo.data.collectionPrefix}Block`, Block);
