var assert = require('chai').assert;
var messageHandler = require('../app/messageHandler');
// Turn off logging for tests.
var logger = require('../app/logger');
logger.logging = false;

var connectedMsg = {
  "Name":"Konrad Aust",
  "NodeType":"Employee",
  "Priority": 1,
  "ConformedDimensions": {
    "Email": "konrad.aust@menome.com",
    "EmployeeId": 12345
  },
  "Properties": {
    "Status":"active"
  },
  "Connections": [
    {
      "Name": "Menome Victoria",
      "NodeType": "Office",
      "RelType": "LocatedInOffice",
      "ForwardRel": true,
      "ConformedDimensions": {
        "City": "Victoria"
      }
    },
    {
      "Name": "theLink",
      "NodeType": "Project",
      "RelType": "WorkedOnProject",
      "ForwardRel": true,
      "ConformedDimensions": {
        "Code": "5"
      }
    }
  ]
}

var connectionlessMsg = {
  "Name":"Konrad Aust",
  "NodeType":"Employee",
  "Priority": 1,
  "ConformedDimensions": {
    "Email": "konrad.aust@menome.com",
    "EmployeeId": 12345
  },
  "Properties": {
    "Status":"active"
  }
}

describe('BuildObjectStr', function () {
  it('Builds a string from an object.', function () {
    var str = messageHandler.buildObjectStr({key1: "string", key2: 21, key3: false, key4: {}, key5: []});
    assert.equal(str, '{key1: "string",key2: 21,key3: false}')
  });
});

describe('GetMergeQuery', function() {
  it('Generates a merge cql query with parameters for a node without connections', function() {
    var expectedQueryStr = 'MERGE (node:Card:Employee {Email: "konrad.aust@menome.com",EmployeeId: 12345})\nON CREATE SET node.Uuid = {newUuid}\nSET node += {nodeParams};';
    var expectedParams = {
      nodeParams:
      {
        Status: 'active',
        Email: 'konrad.aust@menome.com',
        EmployeeId: 12345,
        Name: 'Konrad Aust'
      }
    }

    var mergeQuery = messageHandler.getMergeQuery(connectionlessMsg);
    assert.equal(expectedQueryStr, mergeQuery.compile());
    var agnosticParams = mergeQuery.params()
    delete agnosticParams.newUuid;
    assert.equal(JSON.stringify(expectedParams), JSON.stringify(agnosticParams));
  })

  it('Generates a merge cql query with parameters for a node with connections', function() {
    var expectedQueryStr = 'MERGE(node:Card:Employee{Email:"konrad.aust@menome.com",EmployeeId:12345})ONCREATESETnode.Uuid={newUuid}SETnode+={nodeParams}MERGE(node0:Card:Office{City:"Victoria"})ONCREATESETnode0.Uuid={node0_newUuid}SETnode0+={node0_nodeParams}MERGE(node)-[:LocatedInOffice]->(node0)MERGE(node1:Card:Project{Code:"5"})ONCREATESETnode1.Uuid={node1_newUuid}SETnode1+={node1_nodeParams}MERGE(node)-[:WorkedOnProject]->(node1);';
    var expectedParams = {
      node0_nodeParams: { City: 'Victoria', Name: 'Menome Victoria' },
      node1_nodeParams: { Code: '5', Name: 'theLink' },
      nodeParams:
      {
        Status: 'active',
        Email: 'konrad.aust@menome.com',
        EmployeeId: 12345,
        Name: 'Konrad Aust'
      }
    }

    var mergeQuery = messageHandler.getMergeQuery(connectedMsg);
    var actualQueryStr = mergeQuery.compile().replace(/\s/g,'')
    assert.equal(expectedQueryStr, actualQueryStr);
    var agnosticParams = mergeQuery.params()
    delete agnosticParams.newUuid;
    delete agnosticParams.node0_newUuid;
    delete agnosticParams.node1_newUuid;
    assert.equal(JSON.stringify(expectedParams), JSON.stringify(agnosticParams));
  })
});