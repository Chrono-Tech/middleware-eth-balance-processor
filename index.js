/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

/**
 * Middleware service for handling user balance.
 * Update balances for accounts, which addresses were specified
 * in received transactions from blockParser via amqp
 *
 * @module Chronobank/eth-balance-processor
 * @requires config
 * @requires models/accountModel
 */

const config = require('./config'),
  mongoose = require('mongoose'),
  Promise = require('bluebird');

mongoose.Promise = Promise;
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri, {useMongoClient: true});

const accountModel = require('./models/accountModel'),
  Web3 = require('web3'),
  net = require('net'),
  bunyan = require('bunyan'),
  contract = require('truffle-contract'),
  log = bunyan.createLogger({name: 'core.balanceProcessor'}),
  amqp = require('amqplib'),
  erc20token = require('./build/contracts/TokenContract.json'),
  smEvents = require('./controllers/eventsCtrl')(erc20token),
  updateErc20Balance = require('./services/updateErc20Balance'),
  filterTxsBySMEventsService = require('./services/filterTxsBySMEventsService');

mongoose.accounts.on('disconnected', function () {
  log.error('mongo disconnected!');
  process.exit(0);
});

const provider = new Web3.providers.IpcProvider(config.web3.uri, net);
const web3 = new Web3();
web3.setProvider(provider);


const Erc20Contract = contract(erc20token);
Erc20Contract.setProvider(provider);


const checkErc20Balance = async (tx, channel) => {
  let filtered = tx ? await filterTxsBySMEventsService(tx, web3, smEvents) : [];
  for (let i = 0; i < filtered.length; i++) {
    let event = filtered[i];
    console.log('YYYYY');
    let updatedBalances = await updateErc20Balance(Erc20Contract, tx.logs[i].address, event.payload);
    console.log('CCCCCC', event.payload);
    await new Promise(res => {
      event.payload.save().then(res).catch(
        console.log
      );
    }).timeout(10000);
    console.log('DDDDDDD');
    for (let updateBalance of updatedBalances) {
      console.log('LLLLLLLLLL', `${config.rabbit.serviceName}_balance.${event.name.toLowerCase()}`);
      channel.publish('events', `${config.rabbit.serviceName}_balance.${event.name.toLowerCase()}`, new Buffer(JSON.stringify(updateBalance)));
    }
  }
};

const checkBalance = async (tx, channel) => {
  let accounts = tx ? await accountModel.find({address: {$in: [tx.to, tx.from]}}) : [];

  for (let account of accounts) {
    let balance = await Promise.promisify(web3.eth.getBalance)(account.address);
    await accountModel.update({address: account.address}, {$set: {balance: balance}})
      .catch(() => {
      });

    await  channel.publish('events', `${config.rabbit.serviceName}_balance.${account.address}`, new Buffer(JSON.stringify({
      address: account.address,
      balance: balance,
      tx: tx
    })));
  }
};


let init = async () => {
  let conn = await amqp.connect(config.rabbit.url)
    .catch(() => {
      log.error('rabbitmq is not available!');
      process.exit(0);
    });

  let channel = await conn.createChannel();

  channel.on('close', () => {
    log.error('rabbitmq process has finished!');
    process.exit(0);
  });


  web3.currentProvider.connection.on('end', () => {
    log.error('ipc process has finished!');
    process.exit(0);
  });

  web3.currentProvider.connection.on('error', () => {
    log.error('ipc process has finished!');
    process.exit(0);
  });

  await channel.assertExchange('events', 'topic', {durable: false});
  await channel.assertQueue(`app_${config.rabbit.serviceName}.balance_processor`);
  await channel.bindQueue(`app_${config.rabbit.serviceName}.balance_processor`, 'events', `${config.rabbit.serviceName}_transaction.*`);

  channel.prefetch(2);

  channel.consume(`app_${config.rabbit.serviceName}.balance_processor`, async (data) => {
    try {
      let block = JSON.parse(data.content.toString());
      let tx;
      try{
        tx = await Promise.promisify(web3.eth.getTransactionReceipt)(block.hash || '').timeout(10000);
      } catch(e) {
        tx = await Promise.promisify(web3.eth.getTransactionReceipt)(block.hash || '');
      }
      checkBalance(tx, channel);
      checkErc20Balance(tx, channel);
    } catch (e) {
      console.log(e);
      
      log.error(e);
    }

    channel.ack(data);
  });
};

module.exports = init();
