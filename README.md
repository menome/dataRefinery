# TheLink - dataRefinery

This turns specifically formatted AMQP messages into neo4j graph updates.

### Example Message Format
```
{
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
  "Connections": []
}
```

### Explanation

The graph updates should be incremental. Because of this, queries generated rely heavily on merge statements.

Merge statements require a 'conformed dimension' which is a property that can uniquely identify the node. For a user, that dimension may be their email or user ID. For a project, it may be the project number. Conformed dimensions should be unique across all systems.

Messages can be given a 'priority.' This is an integer. Higher priority messages will overwrite existing data that was tagged with a lower priority.

Connections are a list of other nodes with conformed dimensions that we should merge on. 
Each of these mirrors the top-level structure, but can not possess its own connections object.

### Configuration

Configuration can be specified either through environment variables, or through a JSON config file, located at config/conf.json.

Environment variables will always overwrite JSON configs. If neither are found, defaults will be loaded.

#### Environment Variables:
```
NEO4J_URL=the URL of the neo4j instance. eg. "bolt://neo4j"
NEO4J_USERNAME=the username we're using to connect to neo4j. eg. 'neo4j'
NEO4J_PASSWORD=the password for the user account. eg. 'swordfish'
RABBIT_URL=the URL of the RMQ server. eg. 'amqp://rabbitmq:rabbitmq@rabbit:5672?heartbeat=3600'
```

#### Example JSON Configuration:
```
{
  "neo4j": {
    "url": "bolt://neo4j",
    "user": "neo4j",
    "pass": "swordfish"
  },
  "rabbit": {
    "url": "amqp://rabbitmq:rabbitmq@rabbit:5672?heartbeat=3600",
    "routingKey": "syncevents.harvester.updates",
    "exchange": "syncevents"
  }
}
```