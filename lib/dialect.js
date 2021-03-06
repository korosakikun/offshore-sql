var _ = require('lodash');
var inherits = require('inherits');
var Utils = require('./utils');
var CriteriaProcessor = require('./criteriaProcessor');
var hooks = require('./hooks');

var GenericDialect = function() {
  hooks.apply(this, arguments);
};

inherits(GenericDialect, hooks);

GenericDialect.prototype.CriteriaProcessor = CriteriaProcessor;

GenericDialect.prototype.stringDelimiter = "'";

/* Retrieving infos about tables */
GenericDialect.prototype.describe = function(connection, collection, callback) {
  callback(new Error("ERROR: UNDEFINED_METHOD"));
};

/* Normalizing schema */
GenericDialect.prototype.normalizeSchema = function(schema) {
  throw new Error("DIALECT UNDEFINED METHOD: normalizeSchema");
};


GenericDialect.prototype.normalizeTableName = function(tableName) {
  return tableName;
};

GenericDialect.prototype.sqlEscapeString = function(str) {
  return str;
};

GenericDialect.prototype.createAlias = function(tableAlias, columnName) {
  return tableAlias + '_' + columnName;
};

GenericDialect.prototype.defineColumn = function(table, attrName, attribute) {
  var column;

  if (attribute.autoIncrement && attribute.primaryKey) {
    return table.increments(attrName).primary();
  }

  if (attribute.autoIncrement) {
    table.increments(attrName);
  }
  else {
    switch (attribute.type) {// defining type
      case 'string':
        column = table.string(attrName, attribute.size || undefined);
        break;
      case 'text':
        column = table.text(attrName);
        break;
      case 'mediumtext':
        column = table.text(attrName, 'mediumtext');
        break;
      case 'array':
        column = table.json(attrName);
        break;
      case 'json':
        column = table.json(attrName);
        break;
      case 'longtext':
        column = table.text(attrName, 'longtext');
        break;
      case 'binary':
        column = table.binary(attrName);
        break;
      case 'boolean':
        column = table.boolean(attrName);
        break;
      case 'datetime':
        column = table.datetime(attrName);
        break;
      case 'date':
        column = table.date(attrName);
        break;
      case 'time':
        column = table.time(attrName);
        break;
      case 'float':
      case 'double':
        column = table.float(attrName, 23, 8);
        break;
      case 'decimal':
        column = table.decimal(attrName);
        break;
      case 'int':
      case 'integer':
        column = table.integer(attrName);
        break;
      default:
        console.error("Unregistered type given: '" + attribute.type + "', TEXT type will be used");
        return "TEXT";
    }
  }
  if (attribute.primaryKey) {
    column.primary();
  }


  else if (attribute.unique) {
    column.unique();
  }

  if (attribute.required || attribute.notNull) {
    column.notNullable();
  }

  if (attribute.index) {
    column.index();
  }

  return column;
};

GenericDialect.prototype.insert = function(connection, collection, record) {
  var tableName = this.normalizeTableName(collection.tableName);
  var pk = connection.getPk(tableName);
  var insertQuery = connection.client(tableName).insert(record);
  if (collection.definition[pk].autoIncrement) {
    insertQuery.returning(pk);
  }
  return insertQuery;
};

GenericDialect.prototype.count = function(connection, collection, opts) {
  var self = this;
  var tableName = this.normalizeTableName(collection.tableName);
  var options = Utils.normalizeCriteria(opts);
  var query = new this.CriteriaProcessor(connection, tableName, options, connection.client(tableName)).getQuery();
  query.count('* as cnt');
  return query.then(function(cnt){ return cnt[0]['cnt']; });
};

GenericDialect.prototype.select = function(connection, collection, opts) {

  this.beforeSelect(connection, collection, opts);

  var self = this;
  var select = {};
  select.tableName = this.normalizeTableName(collection.tableName);
  select.alias = this.createAlias('_PARENT_',select.tableName);
  select.pk = connection.getPk(select.tableName);
  select.definition = collection.definition;
  select.options = Utils.normalizeCriteria(opts);
  select.query = new this.CriteriaProcessor(connection, select.alias, select.options, connection.client(select.tableName + ' as ' + select.alias)).getQuery();

  select.selection = [];
  if (!select.options.select) {
    _.keys(select.definition).forEach(function(field) {
      var column = select.alias + '.' + field;
      if (select.selection.indexOf(column) < 0) {
        select.selection.push(column);
        select.query.select(column);
      }
    });
  }
  else {
    select.options.select.forEach(function(field) {
      var column = select.alias + '.' + field;
      if (select.selection.indexOf(column) < 0) {
        select.selection.push(select.alias + '.' + field);
        select.query.select(column);
      }
    });
    delete select.options.select;
  }

  // Aggregates TODO => refactorize
  if (select.options.sum) {
    select.options.sum.forEach(function(keyToSum) {
      var sumAlias = self.createAlias('_SUM_',keyToSum);
      var subQuery = connection.client(select.tableName + ' as ' + sumAlias).sum(sumAlias + '.' + keyToSum + ' as ' + keyToSum).as(keyToSum);
      subQuery = new self.CriteriaProcessor(connection, sumAlias, select.options, subQuery).getQuery();
      if (select.options.groupBy) {
        select.options.groupBy.forEach(function(groupKey,groupIndex) {
          subQuery.groupBy(sumAlias + '.' + groupKey);
          delete select.options.groupBy[groupIndex];
          subQuery.andWhereRaw( '?? = ??', [ sumAlias + '.' + groupKey, select.alias + '.' + groupKey] );
        });
      }
      select.selection.push(subQuery);
      select.query.select(subQuery);
    });
  }

  if (select.options.average) {
    select.options.average.forEach(function(keyToAvg) {
      var avgAlias = self.createAlias('_AVG_',keyToAvg);
      var subQuery = connection.client(select.tableName + ' as ' + avgAlias).avg(avgAlias + '.' + keyToAvg + ' as ' + keyToAvg).as(keyToAvg);
      subQuery = new self.CriteriaProcessor(connection, avgAlias, select.options, subQuery).getQuery();
      if (select.options.groupBy) {
        select.options.groupBy.forEach(function(groupKey,groupIndex) {
          subQuery.groupBy(avgAlias + '.' + groupKey);
          delete select.options.groupBy[groupIndex];
          subQuery.andWhereRaw( '?? = ??', [ avgAlias + '.' + groupKey, select.alias + '.' + groupKey] );
        });
      }      
      select.selection.push(subQuery);
      select.query.select(subQuery);
    });
  }

  if (select.options.min) {
    select.options.min.forEach(function(keyToMin) {
      var minAlias = self.createAlias('_MIN_',keyToMin);
      var subQuery = connection.client(select.tableName + ' as ' + minAlias).min(minAlias + '.' + keyToMin + ' as ' + keyToMin).as(keyToMin);
      subQuery = new self.CriteriaProcessor(connection, minAlias, select.options, subQuery).getQuery();
      if (select.options.groupBy) {
        select.options.groupBy.forEach(function(groupKey,groupIndex) {
          subQuery.groupBy(minAlias + '.' + groupKey);
          delete select.options.groupBy[groupIndex];
          subQuery.andWhereRaw( '?? = ??', [ minAlias + '.' + groupKey, select.alias + '.' + groupKey] );
        });
      }      
      select.selection.push(subQuery);
      select.query.select(subQuery);
    });
  }

  if (select.options.max) {
    select.options.max.forEach(function(keyToMax) {
      var maxAlias = self.createAlias('_MAX_',keyToMax);
      var subQuery = connection.client(select.tableName + ' as ' + maxAlias).max(maxAlias + '.' + keyToMax + ' as ' + keyToMax).as(keyToMax);
      subQuery = new self.CriteriaProcessor(connection, maxAlias, select.options, subQuery).getQuery();
      if (select.options.groupBy) {
        select.options.groupBy.forEach(function(groupKey,groupIndex) {
          subQuery.groupBy(maxAlias + '.' + groupKey);
          delete select.options.groupBy[groupIndex];
          subQuery.andWhereRaw( '?? = ??', [ maxAlias + '.' + groupKey, select.alias + '.' + groupKey] );
        });
      }      
      select.selection.push(subQuery);
      select.query.select(subQuery);
    });
  }

  if (select.options.groupBy) {
    select.options.groupBy.forEach(function(groupKey) {
      select.query = select.query.groupBy(select.alias + '.' + groupKey);
    });
  }
  
  // sort parent before childs sort
  this.selectSort(connection,select);

  if (select.options.joins) {
    select.options.joins.forEach(function(join) {
      join.parent = self.normalizeTableName(join.parent);
      join.child = self.normalizeTableName(join.child);
      self.join(connection, select, join);
    });
  }

  //skip limit
  this.selectSkipLimit(connection, select);

  this.afterSelect(connection, select);

  return select.query;
};


GenericDialect.prototype.selectSort = function(connection,select) {
  if (select.options.sort) {
    _.keys(select.options.sort).forEach(function(toSort) {
      var direction = select.options.sort[toSort] === 1 ? 'ASC' : 'DESC';
      select.query.orderBy(select.alias + '.' + toSort, direction);
    });
  }  
};

GenericDialect.prototype.selectSkipLimit = function(connection,select) {
  var self = this;
  if (select.options.skip || select.options.limit) {
    if (!select.options.joins) {
      if (select.options.skip) {
        select.query.offset(select.options.skip);
      }
      if (select.options.limit) {
        select.query.limit(select.options.limit);
      }
    }
    else {
      select.query.andWhere(select.alias + '.' + select.pk, 'IN', connection.client.select('*').from(function() {
        var query = this;
        this.select(select.pk);
        this.from(select.tableName);
        new self.CriteriaProcessor(connection, select.tableName, select.options, this);
        if (select.options.skip) {
          this.offset(select.options.skip);
        }
        if (select.options.limit) {
          this.limit(select.options.limit);
        }
        if (select.options.sort) {
          _.keys(select.options.sort).forEach(function(toSort) {
            var direction = select.options.sort[toSort] === 1 ? 'ASC' : 'DESC';
            query.orderBy(select.tableName + '.' + toSort, direction);
          });
        }
        this.as('SKLMT');
      }));      
    }
  }
};

GenericDialect.prototype.join = function(connection, select, join) {
  if (join.criteria && (join.criteria.skip || join.criteria.limit)) {
    this.joinSkipLimit(connection, select, join);
  }
  else {
    var self = this;
    var childDefinition = connection.getCollection(join.child).definition;
    var parent = join.parent;
    if (parent === select.tableName) {
      parent = select.alias;
    }
    if (join.select === false) {
      select.query.leftJoin(join.child, function() {
        this.on(parent + '.' + join.parentKey, '=', join.child + '.' + join.childKey);
      });
    }
    else {
      select.query.leftJoin(join.child + ' as ' + join.alias, function() {
        this.on(parent + '.' + join.parentKey, '=', join.alias + '.' + join.childKey);
        if (join.criteria) {
          new self.CriteriaProcessor(connection, join.alias, join.criteria, this, 'on');
        }
      });
      //ADD COLUMN WITH ALIAS IN SELECTION
      if (join.select) {
        join.select.forEach(function(columnName) {
          if (childDefinition[columnName]) {
            var childAlias = self.createAlias(join.alias, columnName);
            var column = join.alias + '.' + columnName + ' as ' + childAlias;
            if (select.selection.indexOf(column) < 0) {
              select.selection.push(column);
              select.query.select(column);
            }
          }
        });
      }
      if (join.criteria && join.criteria.sort) {
        _.keys(join.criteria.sort).forEach(function(toSort) {
          var direction = join.criteria.sort[toSort] === 1 ? 'ASC' : 'DESC';
          select.query.orderBy(join.alias + '.' + toSort, direction);
        });
      }
    }
  }
};

GenericDialect.prototype.joinSkipLimit = function(connection, select, join) {
  var self = this;
  var childDefinition = connection.getCollection(join.child).definition;
  var parent = join.parent;
  if (parent === select.tableName) {
    parent = select.alias;
  }
  if (join.select === false) {
    select.query.leftJoin(join.child, function() {
      this.on(parent + '.' + join.parentKey, '=', join.child + '.' + join.childKey);
    });
  }
  else {
    select.query.leftJoin(join.child + ' as ' + join.alias, function() {
      this.on(parent + '.' + join.parentKey, '=', join.alias + '.' + join.childKey);
      if (join.criteria) {
        new self.CriteriaProcessor(connection, join.alias, join.criteria, this, 'on');
      }
    });
    //ADD COLUMN WITH ALIAS IN SELECTION
    if (join.select) {
      join.select.forEach(function(columnName) {
        if (childDefinition[columnName]) {
          var childAlias = self.createAlias(join.alias, columnName);
          var column = join.alias + '.' + columnName + ' as ' + childAlias;
          if (select.selection.indexOf(column) < 0) {
            select.selection.push(column);
            select.query.select(column);
          }
        }
      });
    }

    var skLmtAlias = this.createAlias('_SKLMT_', join.alias);
    var skLmtQuery = connection.client(join.child + ' as ' + skLmtAlias).count('*');

    if (join.junctionTable) {
      var junctionTable = _.find(select.options.joins, function(junction) {
        return (junction.select === false && junction.alias === join.alias);
      });
      if (junctionTable) {
        skLmtQuery.leftJoin(join.parent, join.parent + '.' + join.parentKey, skLmtAlias + '.' + join.childKey);
        skLmtQuery.leftJoin(junctionTable.parent, junctionTable.parent + '.' + junctionTable.parentKey, junctionTable.child + '.' + junctionTable.childKey);
        skLmtQuery.andWhereRaw( '??.?? = ??.??', [ junctionTable.parent, junctionTable.parentKey, select.alias, select.pk ] );
      }
      else {
        console.log('error junctionTable', junctionTable.length);
      }
    }
    else {
      skLmtQuery.leftJoin(join.parent, join.parent + '.' + join.parentKey, skLmtAlias + '.' + join.childKey);
      skLmtQuery.andWhereRaw( '?? = ??', [ join.parent + '.' + join.parentKey, select.alias + '.' + select.pk ] );
    }
    new self.CriteriaProcessor(connection, skLmtAlias, join.criteria, skLmtQuery);

    if (!join.criteria.sort) {
      join.criteria.sort = {};
      join.criteria.sort[join.childKey] = 1;
    }
    var j;
    var keys = _.keys(join.criteria.sort);
    skLmtQuery.andWhere(function() {
      for (var i in keys) {
        this.orWhere(function() {
          j = 0;
          while (j < i) {
            this.andWhereRaw( '??.?? = ??.??', [ join.alias, keys[j], skLmtAlias, keys[j]]);
          }
          var key = keys[i];
          if (join.criteria.sort[key]) {
            this.andWhereRaw('??.?? > ??.??', [join.alias, keys[i], skLmtAlias, keys[i]]);
          }
          else {
            this.andWhereRaw('??.?? < ??.??', [join.alias, keys[i], skLmtAlias, keys[i]]);
          }
        });
      }
    });
    
    select.selection.push(skLmtQuery.as(skLmtAlias));
    select.query.select(skLmtQuery.as(skLmtAlias));

    if (join.criteria.skip && join.criteria.limit) {
      select.query.andHaving(skLmtAlias, '>=', join.criteria.skip);
      select.query.andHaving(skLmtAlias, '<', join.criteria.limit + join.criteria.skip);
    } else if (join.criteria.skip) {
      select.query.andHaving(skLmtAlias, '>=', join.criteria.skip);
    } else if (join.criteria.limit) {
      select.query.andHaving(skLmtAlias, '<', join.criteria.limit);
    }
    
    if (join.criteria && join.criteria.sort) {
      _.keys(join.criteria.sort).forEach(function(toSort) {
        var direction = join.criteria.sort[toSort] === 1 ? 'ASC' : 'DESC';
        select.query.orderBy(join.alias + '.' + toSort, direction);
      });
    }
  }
};

GenericDialect.prototype.update = function(connection, collection, opts, data) {
  var definition = collection.definition;
  var tableName = this.normalizeTableName(collection.tableName);
  var options = Utils.normalizeCriteria(opts);
  var updateQuery = new this.CriteriaProcessor(connection, tableName, options, connection.client(tableName)).getQuery();
  return updateQuery.update(data);
};

GenericDialect.prototype.delete = function(connection, collection, opts) {
  var tableName = this.normalizeTableName(collection.tableName);
  var options = Utils.normalizeCriteria(opts);
  var deleteQuery = new this.CriteriaProcessor(connection, tableName, options, connection.client(tableName)).getQuery();
  return deleteQuery.del();
};

GenericDialect.prototype.createTable = function(connection, collection, definition) {
  var self = this;
  var tableName = this.normalizeTableName(collection.tableName);
  return connection.client.schema.createTable(tableName, function(table) {
    _.keys(definition).forEach(function(attrName) {
      self.defineColumn(table, attrName, definition[attrName]);
    });
  });
};

GenericDialect.prototype.dropTable = function(connection, collection) {
  var tableName = this.normalizeTableName(collection.tableName);
  return connection.client.schema.dropTableIfExists(tableName);
};

module.exports = GenericDialect;
