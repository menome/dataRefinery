/** 
 * Copyright (C) 2018 Menome Technologies Inc.  
 * 
 * Object for handling messages.
 * Handles parsed/verified messages for DB updates.
 */
var Query = require('decypher').Query;
var util = require('util');
const isoDateRegExp = new RegExp(/^(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))$/);
const events = require('events');

module.exports = function(bot) {
  /* 
   * This is an ephemeral list of the indices we know are in the DB right now.
   * For fast merges we need to make sure that conformed dimensions have indices on them.
   * But we don't want to keep track of indices via excessive state or config or anything complex like that.
   * So instead, we just make sure that an index exists on each conformed dimension by querying the DB and
   * adding it when we get the message.
   * After that, we add it to this list, and never add it again as long as it's in this list.
   * This list gets blown away every time the app restarts, so there will be a few redundant checks. 
   * Shouldn't really be a big performance hit, as we'll only check each index once per mass import.
   */
  var addedIndices = [];
  const batchSize = bot.config.get("rabbit.prefetch"); // Process batches up to this size.
  var currentBatch = [];
  const BatchCompletedEmitter = new events.EventEmitter();
  BatchCompletedEmitter.setMaxListeners(batchSize);

  // This is like JSON.stringify, except property keys are printed without quotes around them
  // And we only include properties that are primitives.
  function buildObjectStr(obj) {
    var paramStrings = [];

    for(var p in obj) {
      if(typeof obj[p] === 'object' || typeof obj[p] === 'function') continue;
      else if(typeof obj[p] == 'string') paramStrings.push(util.format('%s: "%s"',p,obj[p]));
      else paramStrings.push(util.format('%s: %s',p,obj[p]));
    }

    return util.format('{%s}',paramStrings.join(','));
  }

  function getMergeQuery(message,queryProps) {
    var labelType = message.Label ? message.Label : "Card";
    var query = new Query();
    var objectStr = buildObjectStr(message.ConformedDimensions);
    if(objectStr === "{}") return false; // Don't run the query if our conformedDimensions is too small. (Should be caught in the schema. This is just paranoia.)
    var mergeStmt = util.format("(node:"+labelType+":%s %s)",message.NodeType, objectStr);
    query.merge(mergeStmt);
  
    query.add("ON CREATE SET node.Uuid = {newUuid}");
    query.set("node += {nodeParams}");
    query.set("node.TheLinkAddedDate = datetime()")

    // If we're inferring dates, do that here.
    if(bot.config.get("inferDates")) {
      if(!message.DateProperties) message.DateProperties = {};
      Object.keys(message.Properties).forEach((propkey) => {
        if(!!isoDateRegExp.test(message.Properties[propkey])) {
          message.DateProperties[propkey] = message.Properties[propkey]
          delete message.Properties[propkey]
        }
      })
    }

    if(!!message.DateProperties) {
      Object.keys(message.DateProperties).forEach((param,idx) => {
        query.set(util.format("node.%s = datetime($dateparam_%s)", param, idx), {["dateparam_"+idx]: message.DateProperties[param]})
      })
    }
  
    // Deletion of deletable properties. Happens after setting everything.
    if(!!message.DeleteProperties) {
      message.DeleteProperties.forEach((itm,idx) => {
        query.add("REMOVE node."+itm);
      })
    }
  
    // Build up another merge/set statement for each connection
    // TODO: Parameters should be subobjects in the main query params. This is not yet possible in neo4j.
    if(Array.isArray(message.Connections)) {
      message.Connections.forEach((conn,idx) => {

        // If we're inferring dates, do that here.
        if(bot.config.get("inferDates")) {
          if(!conn.DateProperties) conn.DateProperties = {};
          if(!conn.Properties) conn.Properties = {};
          Object.keys(conn.Properties).forEach((propkey) => {
            if(!!isoDateRegExp.test(conn.Properties[propkey])) {
              conn.DateProperties[propkey] = conn.Properties[propkey]
              delete conn.Properties[propkey]
            }
          })

          if(!conn.DateRelProps) conn.DateRelProps = {};
          if(!conn.RelProps) conn.RelProps = {};
          Object.keys(conn.RelProps).forEach((propkey) => {
            if(!!isoDateRegExp.test(conn.RelProps[propkey])) {
              conn.DateRelProps[propkey] = conn.RelProps[propkey]
              delete conn.RelProps[propkey]
            }
          })
        }


        var connLabelType = conn.Label ? conn.Label : "Card";
        var nodeName = "node"+idx;
        var newNodeStmt = util.format("(%s:"+connLabelType+":%s %s)",nodeName,conn.NodeType,buildObjectStr(conn.ConformedDimensions))
        query.merge(newNodeStmt);
        query.add(util.format("ON CREATE SET %s.Uuid = {%s_newUuid}, %s.PendingMerge = true",nodeName,nodeName,nodeName));
        query.merge(util.format("(node)%s-[%s_rel:%s]-%s(%s)",(conn.ForwardRel?"":"<"),nodeName,conn.RelType,(conn.ForwardRel?">":""),nodeName))
        query.set(util.format("%s_rel += {%s_relProps}, %s += {%s_nodeParams}",nodeName, nodeName,nodeName,nodeName))
  
        // Deletion of relationship itself.
        if(conn.DeleteRelationship === true) {
          query.add(util.format("DETACH DELETE %s_rel",nodeName));
        } 
        else {
          // Handle any properties that must be parsed as dates.
          if(!!conn.DateRelProps) {
            Object.keys(conn.DateRelProps).forEach((param,idx) => {
              query.set(util.format("%s_rel.%s = datetime($dateparam_rel_%s_%s)", nodeName, param, nodeName, idx), {["dateparam_rel_"+nodeName+"_"+idx]: conn.DateRelProps[param]})
            })
          }

          if(!!conn.DeleteRelProps) { // Deletion of relationship properties.
            conn.DeleteRelProps.forEach((prop,idx) => {
              query.add(util.format("REMOVE %s_rel.%s", nodeName, prop));
            })
          }
        }
  
        // And if we're deleting the related node itself.
        if(conn.DeleteNode === true) {
          query.add(util.format("DETACH DELETE %s",nodeName));
        }
        else { // Deletion of related node properties.
          if(!!conn.DateProperties) {
            Object.keys(conn.DateProperties).forEach((param,idx) => {
              query.set(util.format("%s.%s = datetime($dateparam_%s_%s)", nodeName, param, nodeName, idx), {["dateparam_"+nodeName+"_"+idx]: conn.DateProperties[param]})
            })
          }
          if(!!conn.DeleteProperties) {
            conn.DeleteProperties.forEach((prop,idx) => {
              query.add(util.format("REMOVE %s.%s", nodeName, prop));
            })
          }
        }
        
  
        // Query parameters.
        var itmParams = Object.assign({},conn.Properties,conn.ConformedDimensions)
        if(!!conn.Name) itmParams.Name = conn.Name;
        query.param(nodeName+"_newUuid", bot.genUuid());
        query.param(nodeName+"_nodeParams", itmParams);
        query.param(nodeName+"_relProps", conn.RelProps ? conn.RelProps : {})
      });
    }
  
    // If we're deleting it, delete it.
    if(message.DeleteNode === true) {
      query.add("DETACH DELETE node");
    }
  
    // Compile our top-level parameters.
    var compiledParams = Object.assign({},queryProps.Properties,message.ConformedDimensions)
    if(!!message.Name) compiledParams.Name = message.Name;
    compiledParams.PendingMerge = false;
    compiledParams.SourceSystems = queryProps.SourceSystems ? queryProps.SourceSystems : undefined;
    compiledParams.SourceSystemPriorities = queryProps.SourceSystemPriorities ? queryProps.SourceSystemPriorities : undefined;
  

    var propList = Object.keys({...queryProps.Properties, ...message.DateProperties}) 
    if(message.SourceSystem) compiledParams["SourceSystemProps_"+message.SourceSystem] = propList
  
    query.params({nodeParams: compiledParams, newUuid: bot.genUuid()});
  
    return query;
  }
  
  // Check before merging. This is for priority checking.
  function checkTarget(transaction, message) {
    if(!message.SourceSystem || !message.Priority || bot.config.get("skipPriorityCheck")) {
      return Promise.resolve({
        Properties: message.Properties
      });
    }

    var retVal = { // If we don't encounter a node to merge with, this is our initial priority info.
      SourceSystems: [message.SourceSystem],
      SourceSystemPriorities: [message.Priority],
      Properties: message.Properties,
    }

    var labelType = message.Label ? message.Label : "Card";
  
    var query = new Query();
    var objectStr = buildObjectStr(message.ConformedDimensions);
    if(objectStr === "{}") return Promise.resolve({});; // Don't run the query if our conformedDimensions is too small. (Should be caught in the schema. This is just paranoia.)
    query.match("(node:"+labelType+":"+message.NodeType+" "+objectStr+")")
    query.return("node")
  
    return transaction.run(query.compile(), query.params()).then((result) => {
      if(result.records.length < 1) return retVal;
  
      var SourceSystems = result.records[0].get('node').properties.SourceSystems;
      var SourceSystemPriorities = result.records[0].get('node').properties.SourceSystemPriorities;
  
      if(!SourceSystems || !SourceSystemPriorities || SourceSystemPriorities.length !== SourceSystems.length) return retVal;
  
      // If this source system is already in the list, find it. Add our system if it doesn't exist.
      var existingSourceSystemIdx = SourceSystems.findIndex((itm) => {return itm === message.SourceSystem})
      if(existingSourceSystemIdx !== -1) {
        SourceSystemPriorities[existingSourceSystemIdx] = message.Priority;
      }
      else {
        SourceSystems.push(message.SourceSystem)
        SourceSystemPriorities.push(message.Priority)
      }
  
      // Figure out properties. Don't update anything that was updated by a higher priority system.
      SourceSystems.forEach((systemName,idx) => {
        var systemPriority = SourceSystemPriorities[idx];
        if(systemPriority <= message.Priority) return; // If we're higher priority, don't filter any props.
  
        var systemProps = result.records[0].get('node').properties["SourceSystemProps_"+systemName]
        if(Array.isArray(systemProps)) {
          systemProps.forEach((prop) => {
            delete retVal.Properties[prop];
          })
        }
      })
  
      retVal.SourceSystems = SourceSystems;
      retVal.SourceSystemPriorities = SourceSystemPriorities;
      return retVal;
    });
  }
  
  // Adds indices for conformed dimensions
  // Use composite indices.
  function addIndices(transaction, message) {
    var indices = Object.keys(message.ConformedDimensions);
    var labelType = message.Label ? message.Label : "Card";
  
    // Check if we even need this index.
    if(addedIndices.indexOf(indices.join()) !== -1) {
      return Promise.resolve(true);
    }
  
    return transaction.run("CREATE INDEX ON :"+labelType+"("+indices.join(',')+")").then((result) => {
      return transaction.run("CREATE INDEX ON :"+message.NodeType+"("+indices.join(',')+")").then((result) => {
        return addedIndices.push(indices.join());
      })
    }).catch((err) => {
      if(err.code === "Neo.ClientError.Schema.ConstraintAlreadyExists")
        return true; // Swallow this. Throws if there's a uniqueness constraint on what we're indexing.
      throw err;
    })
  }

  // Processes a list of messages in a single DB transaction.
  // Returns a list of results. Either 'true', 'false' or 'requeue' for each.
  async function runTransaction(messageList) {
    var session = bot.neo4j.session();

    // We must update indices in a different transaction.
    // Once we record all the indices already present this will be a no-op.
    for(var i=0;i<messageList.length;i++) {
      await addIndices(session, messageList[i])
    }

    const writeTxPromise = session.writeTransaction(async tx => {
      let respList = [];
      for(var i=0;i<messageList.length;i++) {
        let message = messageList[i];
        // Try adding our indices.
        respList[i] = await checkTarget(tx, message).then((queryProps) => {
          var query = getMergeQuery(message, queryProps);
          if(!query) return Promise.reject("Bad query from message.");
        
          return tx.run(query.compile(),query.params()).then(function(result) {          
            return true;
          })
        }).catch(err => {
          bot.logger.error("Failure",{rabbit_msg: message, error:err})      
          // Requeue messages when Neo4j is down.
          if(err.name === "Neo4jError" && (!err.code || err.code.startsWith("ServiceUnavailable") || err.code.startsWith("Neo.TransientError"))) {
            return "requeue"
          }
          return false;
        })
      }

      return respList;
    })
    
    return writeTxPromise.then(results => {
      session.close();
      bot.logger.info("Completed batch of " + results.length);
      BatchCompletedEmitter.emit('complete', results)
      return results;
    }).catch(err => {
      bot.logger.error("Execution should never get here but here we are.", err);
      session.close();
    })
  }

  // Handle a single message. Also handle batching.
  this.handleMessage = function(message) {
    let idx = currentBatch.push(message);

    // If we've hit our batch size in the queue, run the transaction.
    if(idx >= batchSize) {
      runTransaction(currentBatch);
    }

    // Either way, listen for the batch completion event.
    return new Promise((resolve) => {
      let eventFunc = function(resultList) {
        currentBatch = [];
        return resolve(resultList[idx]);
      }

      BatchCompletedEmitter.once('complete', eventFunc)
    })
  }
}