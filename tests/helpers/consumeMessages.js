/** 
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Kirill Sergeev <cloudkserg11@gmail.com>
*/
const config = require('../../config');
module.exports = async (maxCount = 1, channel, parseMessage) => {
  return new Promise(res  => {
    let messageCount = 1;
    channel.consume(`app_${config.rabbit.serviceName}_test.balance`, async (message) => {
      const result = await parseMessage(message);
      if (!result) 
        return;

      if (messageCount === maxCount) {
        await channel.cancel(message.fields.consumerTag);
        res();
      } else
        messageCount++;
    }, {noAck: true});
  });
};

