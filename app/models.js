// JSON Schema for incoming messages.
// Messages that don't pass this get rejected.
const messageSchema = {
  // "$schema":"http://json-schema.org/draft-06/schema#",
  "title": "tldrmessage",
  "type": "object",
  "required": ["Name","NodeType","ConformedDimensions"],
  "additionalProperties": false,
  "properties": {
    "Name": {
      "type": "string"
    },
    "NodeType": {
      "type": "string",
      "pattern": "^[a-zA-Z0-9_]*$"
    },
    "SourceSystem": {
      "type": "string",
      "pattern": "^[a-zA-Z0-9_\\s\.\'&]*$"
    },
    "ConformedDimensions": {
      "type": "object",
      "minProperties": 1,
    },
    "Properties": {
      "type": "object"
    },
    "Connections": { // Basically an array of the same things, minus second-level connections
      "type": "array",
      "items": {
        "type": "object",
        "required": ["NodeType","RelType","ForwardRel","ConformedDimensions"],
        "additionalProperties": false,
        "properties": {
          "Name": {
            "type": "string",
          },
          "NodeType": {
            "type": "string",
            "pattern": "^[a-zA-Z0-9_]*$"
          },
          "ForwardRel": { // True if we're going (node)-[]->(node2). False if (node)<-[]-(node2)
            "type": "boolean"
          },
          "RelType": {
            "type": "string",
            "pattern": "^[a-zA-Z0-9_]*$"
          },
          "ConformedDimensions": {
            "type": "object",
            "minProperties": 1
          },
          "Properties": {
            "type": "object"
          },
          "RelProps": {
            "type": "object"
          }
        }

      }
    },
    "Priority": {
      "type": "number",
      "minimum": 0
    }
  }
}

module.exports = {
  messageSchema
}